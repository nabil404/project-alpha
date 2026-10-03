import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  customerFilters,
  customerPageSizes,
  type CustomerFilter,
  type CustomerListItem,
  type CustomerSort,
  type CustomerSummary,
  type ListCustomersQuery,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { PaginationBar } from '@/components/PaginationBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CustomerAvatar, useCustomerName } from '@/features/conversations';
import { useErrorMessages } from '@/i18n/error-keys';
import { SHOP_CURRENCY } from '@/lib/currency';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useLastOrderLabel } from '../format';
import { useCustomerList, useCustomerSummary } from '../queries';
import { CustomerStatusBadge } from './CustomerStatusBadge';
import { CustomerSummaryCards } from './CustomerSummaryCards';

const SEARCH_DEBOUNCE_MS = 300;

const countKeys = {
  all: 'all',
  needs_you: 'needsYou',
  inactive: 'inactive',
  repeat: 'repeat',
  new: 'new',
} as const satisfies Record<CustomerFilter, keyof CustomerSummary['counts']>;

/**
 * The tabs in the design's order, which is not the status rule's. Keyed by
 * every filter so a new one can't be left without a tab.
 */
const tabPositions = {
  all: 0,
  repeat: 1,
  new: 2,
  needs_you: 3,
  inactive: 4,
} as const satisfies Record<CustomerFilter, number>;
const tabOrder = [...customerFilters].sort((a, b) => tabPositions[a] - tabPositions[b]);

/** Changing anything but the page starts again from the first page. */
export type CustomerListChange = Partial<ListCustomersQuery>;

/**
 * The Customers page: the shop's figures, then the status tabs and search over
 * a page of customers, as a table from `sm` up and as cards below it. The query
 * lives in the URL; the route owns it.
 */
export function CustomerList({
  query,
  onChange,
}: {
  query: ListCustomersQuery;
  onChange: (change: CustomerListChange) => void;
}) {
  const { t } = useTranslation(['customers', 'common']);
  const { forError } = useErrorMessages();
  const { currencySymbol, formatNumber } = useFormatters();
  const summary = useCustomerSummary();
  const list = useCustomerList(query);
  const filtered = query.filter !== 'all' || Boolean(query.q);
  const noCustomers = summary.data?.counts.all === 0;
  const pagination = list.data?.pagination;

  // A page past the end (the list shrank since the link was made) moves back to the last one.
  useEffect(() => {
    if (pagination && pagination.totalPages > 0 && pagination.page > pagination.totalPages) {
      onChange({ page: pagination.totalPages });
    }
  }, [pagination, onChange]);

  const onSort = (sort: CustomerSort) =>
    onChange(
      sort === query.sort
        ? { direction: query.direction === 'desc' ? 'asc' : 'desc' }
        : { sort, direction: 'desc' },
    );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-display">{t('list.title')}</h1>
        <p className="text-body text-ink-muted">{t('list.description')}</p>
      </header>

      <CustomerSummaryCards summary={summary.data} />

      {noCustomers ? (
        <p className="rounded-lg border border-border bg-surface px-6 py-12 text-center text-body text-ink-muted shadow-card">
          {t('list.empty')}
        </p>
      ) : (
        <section
          aria-label={t('list.label')}
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
            <SearchInput value={query.q} onChange={(q) => onChange({ q })} />
            <div
              role="group"
              aria-label={t('list.filters.label')}
              className="flex grow flex-wrap gap-2"
            >
              {tabOrder.map((option) => {
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
                    {summary.data && (
                      <span className="text-ink-muted tabular-nums">
                        {formatNumber(summary.data.counts[countKeys[option]])}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {list.isError ? (
            <div className="flex flex-col items-start gap-3 border-t border-border px-4 py-6 sm:px-6">
              <ErrorBanner className="self-stretch">{forError(list.error)}</ErrorBanner>
              <Button size="sm" onClick={() => void list.refetch()}>
                {t('common:actions.retry')}
              </Button>
            </div>
          ) : list.isPending ? (
            <ListSkeleton />
          ) : list.data.data.length === 0 ? (
            <div className="border-t border-border px-4 py-12 text-center">
              <p className="text-body text-ink-muted">{t('list.emptyFiltered')}</p>
              {filtered && (
                <Button
                  variant="link"
                  className="mt-2"
                  onClick={() => onChange({ filter: 'all', q: undefined })}
                >
                  {t('list.clearFilters')}
                </Button>
              )}
            </div>
          ) : (
            <div
              aria-busy={list.isPlaceholderData || undefined}
              className={cn(
                'transition-opacity duration-200',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              <CustomerCards customers={list.data.data} />
              <div className="relative hidden overflow-x-auto sm:block">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-label whitespace-nowrap text-ink-muted">
                      <th scope="col" className="border-t border-border py-3 pr-4 pl-6">
                        {t('list.columns.customer')}
                      </th>
                      <th
                        scope="col"
                        className="hidden border-t border-border px-4 py-3 lg:table-cell"
                      >
                        {t('list.columns.area')}
                      </th>
                      <SortableHeader sort="orders" query={query} onSort={onSort}>
                        {t('list.columns.orders')}
                      </SortableHeader>
                      <SortableHeader sort="total_spent" query={query} onSort={onSort}>
                        {t('list.columns.totalSpent', {
                          symbol: currencySymbol(SHOP_CURRENCY),
                        })}
                      </SortableHeader>
                      <SortableHeader sort="last_order" query={query} onSort={onSort} align="left">
                        {t('list.columns.lastOrder')}
                      </SortableHeader>
                      <th scope="col" className="border-t border-border py-3 pr-6 pl-4">
                        {t('list.columns.status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.data.map((customer) => (
                      <CustomerRow key={customer.id} customer={customer} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pagination && pagination.total > 0 && (
            <PaginationBar
              page={pagination.page}
              limit={pagination.pageSize}
              pageSizes={customerPageSizes}
              totalPages={pagination.totalPages}
              summary={t('list.pagination.showing', {
                from: formatNumber(
                  Math.min((pagination.page - 1) * pagination.pageSize + 1, pagination.total),
                ),
                to: formatNumber(Math.min(pagination.page * pagination.pageSize, pagination.total)),
                count: pagination.total,
                total: formatNumber(pagination.total),
              })}
              perPageLabel={t('list.pagination.perPageLabel')}
              onPageChange={(page) => onChange({ page })}
              onLimitChange={(pageSize) => onChange({ pageSize })}
            />
          )}
        </section>
      )}
    </div>
  );
}

/**
 * A column the list sorts on. A new column starts at the largest or latest
 * first, the question being who matters most; clicking it again flips it.
 */
function SortableHeader({
  sort,
  query,
  onSort,
  align = 'right',
  children,
}: {
  sort: CustomerSort;
  query: ListCustomersQuery;
  onSort: (sort: CustomerSort) => void;
  align?: 'left' | 'right';
  children: string;
}) {
  const { t } = useTranslation('customers');
  const active = query.sort === sort;
  const Icon = !active ? ArrowUpDown : query.direction === 'desc' ? ArrowDown : ArrowUp;

  return (
    <th
      scope="col"
      aria-sort={active ? (query.direction === 'desc' ? 'descending' : 'ascending') : 'none'}
      className={cn('border-t border-border px-4 py-3', align === 'right' && 'text-right')}
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        title={t(active ? 'list.sort.reverse' : 'list.sort.by', { column: children })}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded-sm hover:text-ink',
          active && 'text-ink',
        )}
      >
        {children}
        <Icon aria-hidden strokeWidth={1.5} className="size-3.5" />
      </button>
    </th>
  );
}

function CustomerRow({ customer }: { customer: CustomerListItem }) {
  const customerName = useCustomerName();
  const lastOrderLabel = useLastOrderLabel();
  const { formatAmount, formatNumber } = useFormatters();

  return (
    <tr className="border-t border-border hover:bg-surface-hover">
      <td className="py-3 pr-4 pl-6">
        <Link
          to="/customers/$customerId"
          params={{ customerId: customer.id }}
          className="flex min-w-0 items-center gap-3 text-ink"
        >
          <CustomerAvatar
            name={customer.name}
            pictureUrl={customer.pictureUrl}
            className="size-9"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body font-medium">{customerName(customer.name)}</span>
            {customer.phone && (
              <span className="truncate text-small text-ink-muted">{customer.phone}</span>
            )}
          </span>
        </Link>
      </td>
      <td className="hidden max-w-48 px-4 py-3 text-body text-ink-muted lg:table-cell">
        <span className="line-clamp-2">{customer.area}</span>
      </td>
      <td className="px-4 py-3 text-right text-body tabular-nums">
        {formatNumber(customer.orderCount)}
      </td>
      <td className="px-4 py-3 text-right text-body tabular-nums">
        {formatAmount(customer.totalSpent, SHOP_CURRENCY)}
      </td>
      <td className="px-4 py-3 text-small whitespace-nowrap text-ink-muted">
        {lastOrderLabel(customer.lastOrderAt)}
      </td>
      <td className="py-3 pr-6 pl-4">
        <CustomerStatusBadge status={customer.status} />
      </td>
    </tr>
  );
}

/** Below `sm`: one card per customer, the whole card a link. */
function CustomerCards({ customers }: { customers: CustomerListItem[] }) {
  const { t } = useTranslation('customers');
  const customerName = useCustomerName();
  const lastOrderLabel = useLastOrderLabel();
  const { formatMoney } = useFormatters();

  return (
    <ul className="border-t border-border sm:hidden">
      {customers.map((customer) => (
        <li key={customer.id} className="border-b border-border last:border-b-0">
          <Link
            to="/customers/$customerId"
            params={{ customerId: customer.id }}
            className="flex gap-3 px-4 py-3 text-ink hover:bg-surface-hover"
          >
            <CustomerAvatar name={customer.name} pictureUrl={customer.pictureUrl} />
            <span className="flex min-w-0 grow flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-body font-medium">
                  {customerName(customer.name)}
                </span>
                <span className="text-body font-medium whitespace-nowrap tabular-nums">
                  {formatMoney(customer.totalSpent, SHOP_CURRENCY)}
                </span>
              </span>
              <span className="flex justify-between gap-2 text-small text-ink-muted">
                <span className="truncate">{customer.area ?? customer.phone}</span>
                <span className="whitespace-nowrap">
                  {customer.orderCount === 0
                    ? t('list.card.noOrders')
                    : t('list.card.orders', { count: customer.orderCount })}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <CustomerStatusBadge status={customer.status} />
                <span className="truncate text-small text-ink-muted">
                  {t('list.card.lastOrder', { when: lastOrderLabel(customer.lastOrderAt) })}
                </span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
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
  const { t } = useTranslation('customers');
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
    <div className="relative flex w-full items-center sm:w-80">
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

function ListSkeleton() {
  return (
    <ul aria-hidden className="border-t border-border">
      {Array.from({ length: 5 }, (_, index) => (
        <li
          key={index}
          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:px-6"
        >
          <span className="size-9 animate-pulse rounded-full bg-surface-sunken" />
          <span className="h-3.5 w-40 animate-pulse rounded-sm bg-surface-sunken" />
          <span className="ml-auto h-3.5 w-16 animate-pulse rounded-sm bg-surface-sunken" />
        </li>
      ))}
    </ul>
  );
}
