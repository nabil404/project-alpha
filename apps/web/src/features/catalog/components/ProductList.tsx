import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  LOW_STOCK_THRESHOLD,
  PRODUCT_LIST_PAGE_SIZES,
  productListFilters,
  stockLevels,
  type ListProductsQuery,
  type ProductCounts,
  type ProductListFilter,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { statusToneDotClasses, stockLevelTones } from '@/i18n/status-tones';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import { toCategoryEntries } from '../category-entries';
import { CATALOG_CURRENCY } from '../currency';
import { useCategories, useProductCounts, useProductList } from '../queries';
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
      <header className="flex flex-wrap items-center gap-4">
        <div className="flex grow flex-col gap-1">
          <h1 className="text-display">{t('list.title')}</h1>
          <p className="text-body text-ink-muted">{t('list.description')}</p>
        </div>
        <Button asChild variant="primary">
          <Link to="/catalog/products/new">
            <Plus aria-hidden strokeWidth={1.5} />
            {t('list.addProduct')}
          </Link>
        </Button>
      </header>

      <CatalogTabs />

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
              options={toCategoryEntries(categories.data ?? [])}
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
                    {t('list.columns.price', { symbol: currencySymbol(CATALOG_CURRENCY) })}
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
              total={pagination.total}
              totalPages={pagination.totalPages}
              onChange={onChange}
            />
          )}
        </section>
      )}
    </div>
  );
}

/**
 * The catalog's sections. Categories has no page yet, so its tab shows but
 * does nothing rather than leading to one that doesn't exist.
 */
function CatalogTabs() {
  const { t } = useTranslation('catalog');
  const tab =
    '-mb-px flex h-11 shrink-0 items-center border-b-2 px-1 text-body font-medium transition-colors duration-[120ms]';

  return (
    <nav
      aria-label={t('list.tabs.label')}
      className="-mt-2 flex gap-6 overflow-x-auto border-b border-border"
    >
      <Link to="/catalog" aria-current="page" className={cn(tab, 'border-accent text-accent')}>
        {t('list.tabs.products')}
      </Link>
      <span
        aria-disabled="true"
        title={t('list.tabs.soon')}
        className={cn(tab, 'cursor-not-allowed border-transparent text-ink-disabled')}
      >
        {t('list.tabs.categories')}
        <span className="sr-only">{t('list.tabs.soon')}</span>
      </span>
    </nav>
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
  options: { id: string; name: string; path: string }[];
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
            {option.path ? `${option.path} › ${option.name}` : option.name}
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

/** The first and last page, the ones either side of the current page, and gaps between. */
function pageItems(page: number, totalPages: number): (number | 'gap')[] {
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b);
  return pages.flatMap((n, index) => {
    const previous = pages[index - 1];
    if (previous === undefined || n === previous + 1) return [n];
    // A gap of one page shows that page rather than an ellipsis standing for it.
    return n === previous + 2 ? [previous + 1, n] : ['gap' as const, n];
  });
}

function PaginationBar({
  page,
  limit,
  total,
  totalPages,
  onChange,
}: {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  onChange: (change: ProductListChange) => void;
}) {
  const { t } = useTranslation('catalog');
  const from = Math.min((page - 1) * limit + 1, total);
  const to = Math.min(page * limit, total);
  const pageButton = 'min-w-8 tabular-nums';

  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-3 sm:px-6">
      <label className="flex items-center gap-2 text-small text-ink-muted">
        {t('list.pagination.perPageBefore')}
        <span className="relative flex items-center">
          <select
            aria-label={t('list.pagination.perPageLabel')}
            value={limit}
            onChange={(event) => onChange({ limit: Number(event.target.value) })}
            className="h-8 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface pr-7 pl-2.5 text-small text-ink tabular-nums hover:bg-surface-hover"
          >
            {PRODUCT_LIST_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            strokeWidth={1.5}
            className="pointer-events-none absolute right-1.5 size-4 text-ink-muted"
          />
        </span>
        {t('list.pagination.perPageAfter')}
      </label>
      <span className="grow text-small text-ink-muted">
        {t('list.pagination.showing', { from, to, count: total })}
      </span>
      <nav aria-label={t('list.pagination.label')} className="flex items-center gap-1">
        <Button
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange({ page: page - 1 })}
          className="px-2"
        >
          <ChevronLeft aria-hidden strokeWidth={1.5} />
          {t('list.pagination.previous')}
        </Button>
        {pageItems(page, totalPages).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden
              className="min-w-6 text-center text-small text-ink-muted"
            >
              …
            </span>
          ) : (
            <Button
              key={item}
              size="sm"
              variant={item === page ? 'primary' : 'ghost'}
              aria-current={item === page ? 'page' : undefined}
              aria-label={t('list.pagination.page', { page: item })}
              onClick={() => onChange({ page: item })}
              className={cn(pageButton, 'px-2')}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onChange({ page: page + 1 })}
          className="px-2"
        >
          {t('list.pagination.next')}
          <ChevronRight aria-hidden strokeWidth={1.5} />
        </Button>
      </nav>
    </div>
  );
}
