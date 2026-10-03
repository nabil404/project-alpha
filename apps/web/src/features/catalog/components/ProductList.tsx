import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Plus, Search, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  LOW_STOCK_THRESHOLD,
  PRODUCT_LIST_PAGE_SIZES,
  productListFilters,
  stockLevels,
  type CategoryWithCount,
  type ListProductsQuery,
  type ProductCounts,
  type ProductListFilter,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { PaginationBar } from '@/components/PaginationBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { statusToneDotClasses, stockLevelTones } from '@/i18n/status-tones';
import { SHOP_CURRENCY } from '@/lib/currency';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useCategories, useProductCounts, useProductList } from '../queries';
import { CatalogHeader } from './CatalogHeader';
import { ProductListRow } from './ProductListRow';
import { productColumns as columns } from './product-table-columns';

const SEARCH_DEBOUNCE_MS = 300;

const countKeys = {
  all: 'all',
  in_stock: 'inStock',
  low_stock: 'lowStock',
  out_of_stock: 'outOfStock',
  draft: 'draft',
  archived: 'archived',
} as const satisfies Record<ProductListFilter, keyof ProductCounts>;

const legendKeys = {
  in_stock: 'list.legend.in',
  low_stock: 'list.legend.low',
  out_of_stock: 'list.legend.out',
} as const;

/** Changing anything but the page starts again from the first page. */
export type ProductListChange = Partial<ListProductsQuery>;

/**
 * The Products page: the stock alert, then search, category and the filter
 * chips over a page of products. The query lives in the URL; the route owns it.
 */
export function ProductList({
  query,
  onChange,
}: {
  query: ListProductsQuery;
  onChange: (change: ProductListChange) => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const { currencySymbol } = useFormatters();
  const counts = useProductCounts();
  const list = useProductList(query);
  const categories = useCategories();
  const categoryNames = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  );
  const filtered = query.filter !== 'all' || Boolean(query.q) || Boolean(query.categoryId);
  const noProducts = counts.data?.all === 0 && counts.data.archived === 0 && !filtered;
  const pagination = list.data?.pagination;

  // A page past the end (the last product on it was deleted, say) moves back to the last one.
  useEffect(() => {
    if (pagination && pagination.totalPages > 0 && pagination.page > pagination.totalPages) {
      onChange({ page: pagination.totalPages });
    }
  }, [pagination, onChange]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <CatalogHeader
        section="products"
        action={
          <Button asChild variant="primary">
            <Link to="/catalog/products/new">
              <Plus aria-hidden strokeWidth={1.5} />
              {t('list.addProduct')}
            </Link>
          </Button>
        }
      />

      {counts.data && <StockAlert counts={counts.data} onShow={(filter) => onChange({ filter })} />}

      {noProducts ? (
        <p className="rounded-lg border border-border bg-surface px-6 py-12 text-center text-body text-ink-muted shadow-card">
          {t('list.empty')}
        </p>
      ) : (
        <section
          aria-label={t('list.label')}
          className="@container overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
            <SearchInput value={query.q} onChange={(q) => onChange({ q })} />
            <CategorySelect
              value={query.categoryId}
              options={categories.data ?? []}
              onChange={(categoryId) => onChange({ categoryId })}
            />
            <div
              role="group"
              aria-label={t('list.filters.label')}
              className="flex grow flex-wrap gap-2"
            >
              {productListFilters.map((option) => {
                const pressed = option === query.filter;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => onChange({ filter: option })}
                    className={cn(
                      'flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-label transition-colors duration-[120ms] sm:h-8',
                      pressed
                        ? 'border-accent-soft bg-accent-soft text-accent'
                        : 'border-border bg-surface text-ink hover:bg-surface-hover',
                    )}
                  >
                    {t(`list.filters.${option}`)}
                    {counts.data && (
                      <span className="text-ink-muted tabular-nums">
                        {counts.data[countKeys[option]]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <StockLegend />

          {/*
            `relative` makes this the containing block of the cells' sr-only
            labels. Without it they are placed against the page, outside the
            scroll box, and a table wider than a phone widens the page with
            them: the browser zooms out instead of scrolling the table.
          */}
          <div className="relative overflow-x-auto">
            {/*
              Fixed layout: the widths below hold whatever rows are showing, so
              expanding a product doesn't reflow the columns. Columns drop out
              as the card narrows (product-table-columns.ts); only below the
              always-shown ones does the table scroll sideways.
            */}
            <table className="w-full min-w-[36rem] table-fixed border-collapse">
              <colgroup>
                <col className="w-12" />
                <col />
                <col className={columns.category.col} />
                <col className={columns.variants.col} />
                <col className={columns.options.col} />
                <col className="w-36" />
                <col className="w-40" />
                <col className={columns.status.col} />
              </colgroup>
              <thead>
                <tr className="text-left text-label whitespace-nowrap text-ink-muted">
                  <th scope="col" className="w-12 border-t border-border py-3 pr-0 pl-4">
                    <span className="sr-only">{t('list.columns.expand')}</span>
                  </th>
                  <th scope="col" className="border-t border-border py-3 pr-4 pl-2">
                    {t('list.columns.product')}
                  </th>
                  <th
                    scope="col"
                    className={cn('border-t border-border px-4 py-3', columns.category.cell)}
                  >
                    {t('list.columns.category')}
                  </th>
                  <th
                    scope="col"
                    className={cn('border-t border-border px-4 py-3', columns.variants.cell)}
                  >
                    {t('list.columns.variants')}
                  </th>
                  <th
                    scope="col"
                    className={cn('border-t border-border px-4 py-3', columns.options.cell)}
                  >
                    {t('list.columns.options')}
                  </th>
                  <th scope="col" className="border-t border-border px-4 py-3 text-right">
                    {t('list.columns.price', { symbol: currencySymbol(SHOP_CURRENCY) })}
                  </th>
                  <th scope="col" className="border-t border-border px-4 py-3 text-right">
                    {t('list.columns.stock')}
                  </th>
                  <th
                    scope="col"
                    className={cn('border-t border-border px-4 py-3', columns.status.cell)}
                  >
                    {t('list.columns.status')}
                  </th>
                </tr>
              </thead>
              <tbody
                aria-busy={list.isPlaceholderData || undefined}
                className={cn(
                  'transition-opacity duration-200',
                  list.isPlaceholderData && 'opacity-60',
                )}
              >
                {list.isError ? (
                  <tr className="border-t border-border">
                    <td colSpan={8} className="px-4 py-6 sm:px-6">
                      <div className="flex flex-col items-start gap-3">
                        <ErrorBanner className="self-stretch">{forError(list.error)}</ErrorBanner>
                        <Button size="sm" onClick={() => void list.refetch()}>
                          {t('common:actions.retry')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : list.isPending ? (
                  <TableSkeleton />
                ) : list.data.data.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={8} className="px-4 py-12 text-center">
                      <p className="text-body text-ink-muted">{t('list.emptyFiltered')}</p>
                      {filtered && (
                        <Button
                          variant="link"
                          className="mt-2"
                          onClick={() =>
                            onChange({ filter: 'all', q: undefined, categoryId: undefined })
                          }
                        >
                          {t('list.clearFilters')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ) : (
                  list.data.data.map((item) => (
                    <ProductListRow key={item.id} item={item} categoryNames={categoryNames} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {pagination && pagination.total > 0 && (
            <PaginationBar
              page={pagination.page}
              limit={pagination.limit}
              pageSizes={PRODUCT_LIST_PAGE_SIZES}
              totalPages={pagination.totalPages}
              summary={t('list.pagination.showing', {
                from: Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total),
                to: Math.min(pagination.page * pagination.limit, pagination.total),
                count: pagination.total,
              })}
              perPageLabel={t('list.pagination.perPageLabel')}
              onPageChange={(page) => onChange({ page })}
              onLimitChange={(limit) => onChange({ limit })}
            />
          )}
        </section>
      )}
    </div>
  );
}

/** Shown while anything is low or out, with a shortcut to the matching chip. */
function StockAlert({
  counts,
  onShow,
}: {
  counts: ProductCounts;
  onShow: (filter: ProductListFilter) => void;
}) {
  const { t } = useTranslation('catalog');
  if (counts.lowStock === 0 && counts.outOfStock === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-warning-soft px-4 py-3"
    >
      <TriangleAlert aria-hidden strokeWidth={1.5} className="size-5 shrink-0 text-warning" />
      <p className="grow text-body text-ink">
        <strong className="font-semibold">
          {[
            counts.lowStock > 0 && t('list.alert.lowCount', { count: counts.lowStock }),
            counts.outOfStock > 0 && t('list.alert.outCount', { count: counts.outOfStock }),
          ]
            .filter(Boolean)
            .join(' ')}
        </strong>{' '}
        {t('list.alert.hint')}
      </p>
      <span className="flex gap-4">
        {counts.lowStock > 0 && (
          <Button variant="link" className="text-warning" onClick={() => onShow('low_stock')}>
            {t('list.alert.showLow')}
          </Button>
        )}
        {counts.outOfStock > 0 && (
          <Button variant="link" className="text-warning" onClick={() => onShow('out_of_stock')}>
            {t('list.alert.showOut')}
          </Button>
        )}
      </span>
    </div>
  );
}

function StockLegend() {
  const { t } = useTranslation('catalog');
  const { stockLevel } = useStatusLabels();

  return (
    <div
      role="note"
      aria-label={t('list.legend.label')}
      className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 border-t border-border px-4 py-3 text-small text-ink-muted sm:px-6"
    >
      <span className="font-medium">{t('list.legend.label')}</span>
      {stockLevels.map((level) => (
        <span key={level} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn('size-2 rounded-full', statusToneDotClasses[stockLevelTones[level]])}
          />
          <span className="text-ink">{stockLevel(level)}</span>
          <span>{t(legendKeys[level], { threshold: LOW_STOCK_THRESHOLD })}</span>
        </span>
      ))}
    </div>
  );
}

/** Typing updates the box at once and the URL (and so the query) once the seller pauses. */
function SearchInput({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (q: string | undefined) => void;
}) {
  const { t } = useTranslation('catalog');
  const [draft, setDraft] = useState(value ?? '');

  // Back/forward changes the URL under the box.
  useEffect(() => setDraft(value ?? ''), [value]);

  useEffect(() => {
    const next = draft.trim() || undefined;
    if (next === value) return;
    const timer = setTimeout(() => onChange(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <div className="relative flex w-full items-center sm:w-64">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 size-4 text-ink-muted"
        strokeWidth={1.5}
      />
      <Input
        type="search"
        aria-label={t('list.searchLabel')}
        placeholder={t('list.searchPlaceholder')}
        maxLength={100}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="pl-9"
      />
    </div>
  );
}

function CategorySelect({
  value,
  options,
  onChange,
}: {
  value: string | undefined;
  options: CategoryWithCount[];
  onChange: (categoryId: string | undefined) => void;
}) {
  const { t } = useTranslation('catalog');

  return (
    <span className="relative flex items-center max-sm:w-full">
      <select
        aria-label={t('list.categoryLabel')}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="h-10 w-full cursor-pointer appearance-none rounded-md border border-border-strong bg-surface pr-9 pl-4 text-body text-ink hover:bg-surface-hover"
      >
        <option value="">{t('list.allCategories')}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute right-3 size-4 text-ink-muted"
      />
    </span>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <tr key={index} aria-hidden className="border-t border-border">
          <td className="py-3 pl-4" />
          <td className="py-3 pr-4 pl-2">
            <span className="flex items-center gap-3">
              <span className="size-10 animate-pulse rounded-md bg-surface-sunken" />
              <span className="h-3.5 w-36 animate-pulse rounded-sm bg-surface-sunken" />
            </span>
          </td>
          {[
            columns.category.cell,
            columns.variants.cell,
            columns.options.cell,
            '',
            '',
            columns.status.cell,
          ].map((visibility, cell) => (
            <td key={cell} className={cn('px-4 py-3', visibility)}>
              <span className="block h-3.5 w-16 animate-pulse rounded-sm bg-surface-sunken" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
