import { useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, ArrowUpDown, Bot, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  orderPageSizes,
  type ListOrdersQuery,
  type OrderFilter,
  type OrderListItem,
  type OrderSort,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { PaginationBar } from '@/components/PaginationBar';
import { SearchInput } from '@/components/SearchInput';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { paymentStatusTones, statusToneClasses } from '@/i18n/status-tones';
import { useFormatters } from '@/lib/format';
import { useShopRegion } from '@/lib/shop-region';
import { cn } from '@/lib/utils';

import { rangeInstants, type OrderRangeChoice } from '../date-range';
import { useLineLabel, usePlacedLabel } from '../format';
import { useOrderList, useOrderSummary } from '../queries';
import { CreateOrderDialog } from './CreateOrderDialog';
import { DateRangeFilter } from './DateRangeFilter';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderSummaryCards } from './OrderSummaryCards';

/** The tabs in the design's order: the lifecycle, then the two ways out of it. */
const tabOrder = [
  'all',
  'new',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
] as const satisfies readonly OrderFilter[];

/** What the route keeps in the URL: the API's query, with the dates as the seller chose them. */
export type OrderListView = Omit<ListOrdersQuery, 'from' | 'to'> & OrderRangeChoice;

/** Changing anything but the page starts again from the first page. */
export type OrderListChange = Partial<OrderListView>;

/**
 * The Orders page: the figures, then search, dates and the status tabs over a
 * page of orders, as a table from `md` up and as cards below it. The view
 * lives in the URL; the route owns it.
 */
export function OrderList({
  view,
  onChange,
}: {
  view: OrderListView;
  onChange: (change: OrderListChange) => void;
}) {
  const { t } = useTranslation(['orders', 'common']);
  const { forError } = useErrorMessages();
  const { currencySymbol, formatNumber } = useFormatters();
  const { timeZone } = useShopRegion();

  const { range, from: fromDay, to: toDay, ...rest } = view;
  const bounds = rangeInstants({ range, from: fromDay, to: toDay }, timeZone);
  const query: ListOrdersQuery = { ...rest, ...bounds };
  const list = useOrderList(query);
  const summary = useOrderSummary({ q: view.q, ...bounds });
  const cards = useOrderSummary();
  const pagination = list.data?.pagination;
  const filtered = view.status !== 'all' || Boolean(view.q) || view.range !== 'all';
  const noOrders = cards.data?.counts.all === 0;

  // A page past the end (the list shrank since the link was made) moves back to the last one.
  useEffect(() => {
    if (pagination && pagination.totalPages > 0 && pagination.page > pagination.totalPages) {
      onChange({ page: pagination.totalPages });
    }
  }, [pagination, onChange]);

  const onSort = (sort: OrderSort) =>
    onChange(
      sort === view.sort
        ? { direction: view.direction === 'desc' ? 'asc' : 'desc' }
        : { sort, direction: 'desc' },
    );

  const awaiting = cards.data?.awaitingConfirmation ?? 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-display">{t('list.title')}</h1>
          <p className="text-body text-ink-muted">{t('list.description')}</p>
        </div>
        <CreateOrderDialog
          trigger={
            <Button variant="primary" className="max-sm:grow">
              <Plus aria-hidden strokeWidth={1.5} />
              {t('create.open')}
            </Button>
          }
        />
      </header>

      <OrderSummaryCards summary={cards.data} />

      {awaiting > 0 && view.status !== 'new' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-soft bg-accent-soft px-4 py-3 text-accent">
          <Bot aria-hidden strokeWidth={1.5} className="size-5 shrink-0" />
          <p className="min-w-0 grow text-body">
            {t('list.awaiting', { count: awaiting, formatted: formatNumber(awaiting) })}
          </p>
          <Button size="sm" onClick={() => onChange({ status: 'new' })}>
            {t('list.showDrafted')}
          </Button>
        </div>
      )}

      {noOrders ? (
        <p className="rounded-lg border border-border bg-surface px-6 py-12 text-center text-body text-ink-muted shadow-card">
          {t('list.empty')}
        </p>
      ) : (
        <section
          aria-label={t('list.label')}
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-3">
              <SearchInput
                value={view.q}
                onChange={(q) => onChange({ q })}
                label={t('list.searchLabel')}
                placeholder={t('list.searchPlaceholder')}
              />
              <DateRangeFilter
                value={{ range, from: fromDay, to: toDay }}
                onChange={(choice) => onChange(choice)}
              />
            </div>
            <div role="group" aria-label={t('list.filters.label')} className="flex flex-wrap gap-2">
              {tabOrder.map((option) => {
                const pressed = option === view.status;
                const count = summary.data?.counts[option];
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => onChange({ status: option })}
                    className={cn(
                      'flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-label transition-colors duration-[120ms] sm:h-8',
                      pressed
                        ? 'border-accent-soft bg-accent-soft text-accent'
                        : 'border-border bg-surface text-ink hover:bg-surface-hover',
                    )}
                  >
                    <TabLabel filter={option} />
                    {count !== undefined && (
                      <span className="text-ink-muted tabular-nums">{formatNumber(count)}</span>
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
                  onClick={() =>
                    onChange({
                      status: 'all',
                      q: undefined,
                      range: 'all',
                      from: undefined,
                      to: undefined,
                    })
                  }
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
              <OrderCards orders={list.data.data} />
              <div className="relative hidden overflow-x-auto md:block">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-surface-sunken text-left text-label whitespace-nowrap text-ink-muted">
                      <th scope="col" className="border-t border-border py-3 pr-4 pl-6">
                        {t('list.columns.order')}
                      </th>
                      <th scope="col" className="border-t border-border px-4 py-3">
                        {t('list.columns.customer')}
                      </th>
                      <th
                        scope="col"
                        className="hidden border-t border-border px-4 py-3 lg:table-cell"
                      >
                        {t('list.columns.items')}
                      </th>
                      <SortableHeader sort="total" view={view} onSort={onSort}>
                        {t('list.columns.total', { symbol: currencySymbol() })}
                      </SortableHeader>
                      <th
                        scope="col"
                        className="hidden border-t border-border px-4 py-3 xl:table-cell"
                      >
                        {t('list.columns.payment')}
                      </th>
                      <th scope="col" className="border-t border-border px-4 py-3">
                        {t('list.columns.status')}
                      </th>
                      <SortableHeader sort="placed_at" view={view} onSort={onSort} align="left">
                        {t('list.columns.date')}
                      </SortableHeader>
                      <th scope="col" className="border-t border-border py-3 pr-6 pl-4">
                        <span className="sr-only">{t('list.columns.action')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.data.map((order) => (
                      <OrderRow key={order.id} order={order} />
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
              pageSizes={orderPageSizes}
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

function TabLabel({ filter }: { filter: OrderFilter }) {
  const { t } = useTranslation('orders');
  const { orderStatus } = useStatusLabels();
  return <>{filter === 'all' ? t('list.filters.all') : orderStatus(filter)}</>;
}

/** A column the list sorts on: a new one starts largest or latest first; clicking it again flips it. */
function SortableHeader({
  sort,
  view,
  onSort,
  align = 'right',
  children,
}: {
  sort: OrderSort;
  view: OrderListView;
  onSort: (sort: OrderSort) => void;
  align?: 'left' | 'right';
  children: string;
}) {
  const { t } = useTranslation('orders');
  const active = view.sort === sort;
  const Icon = !active ? ArrowUpDown : view.direction === 'desc' ? ArrowDown : ArrowUp;

  return (
    <th
      scope="col"
      aria-sort={active ? (view.direction === 'desc' ? 'descending' : 'ascending') : 'none'}
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

/** "Blue kurti, M × 2" and "+1 more" when the order has more lines. */
function ItemsSummary({ order }: { order: OrderListItem }) {
  const { t } = useTranslation('orders');
  const lineLabel = useLineLabel();
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{lineLabel(order.firstItem)}</span>
      {order.itemCount > 1 && (
        <span className="shrink-0 text-small text-ink-muted">
          {t('list.moreItems', { count: order.itemCount - 1 })}
        </span>
      )}
    </span>
  );
}

function PaymentCell({ order }: { order: OrderListItem }) {
  const { paymentStatus, paymentMethod } = useStatusLabels();
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span
        className={cn(
          'inline-flex h-5 items-center rounded-full px-2 text-label',
          statusToneClasses[paymentStatusTones[order.paymentStatus]],
        )}
      >
        {paymentStatus(order.paymentStatus)}
      </span>
      <span className="text-small whitespace-nowrap text-ink-muted">
        {paymentMethod(order.paymentMethod)}
      </span>
    </span>
  );
}

function OrderRow({ order }: { order: OrderListItem }) {
  const { t } = useTranslation('orders');
  const { orderSource } = useStatusLabels();
  const { formatAmount } = useFormatters();
  const placedLabel = usePlacedLabel();

  return (
    <tr className="border-t border-border hover:bg-surface-hover">
      <td className="py-3 pr-4 pl-6 whitespace-nowrap">
        <Link
          to="/orders/$orderId"
          params={{ orderId: order.id }}
          className="flex flex-col font-mono text-code text-ink hover:text-link"
        >
          {order.reference}
          <span className="font-sans text-small text-ink-muted">{orderSource(order.source)}</span>
        </Link>
      </td>
      <td className="max-w-48 px-4 py-3">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-medium">{order.customer.name}</span>
          <span className="truncate text-small text-ink-muted">{order.customer.phone}</span>
        </span>
      </td>
      <td className="hidden max-w-64 px-4 py-3 text-body lg:table-cell">
        <ItemsSummary order={order} />
      </td>
      <td className="px-4 py-3 text-right text-body whitespace-nowrap tabular-nums">
        {formatAmount(order.total, order.currency)}
      </td>
      <td className="hidden px-4 py-3 xl:table-cell">
        <PaymentCell order={order} />
      </td>
      <td className="px-4 py-3">
        <OrderStatusBadge status={order.status} />
      </td>
      <td className="px-4 py-3 text-small whitespace-nowrap text-ink-muted">
        {placedLabel(order.placedAt)}
      </td>
      <td className="py-3 pr-6 pl-4 text-right">
        {order.status === 'new' && (
          <Button asChild size="sm" variant="primary">
            <Link to="/orders/$orderId" params={{ orderId: order.id }}>
              {t('list.review')}
            </Link>
          </Button>
        )}
      </td>
    </tr>
  );
}

/** Below `md`: one card per order, the whole card a link. */
function OrderCards({ orders }: { orders: OrderListItem[] }) {
  const { formatMoney } = useFormatters();
  const placedLabel = usePlacedLabel();

  return (
    <ul className="border-t border-border md:hidden">
      {orders.map((order) => (
        <li key={order.id} className="border-b border-border last:border-b-0">
          <Link
            to="/orders/$orderId"
            params={{ orderId: order.id }}
            className="flex flex-col gap-1 px-4 py-3 text-ink hover:bg-surface-hover"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-mono text-code text-ink-muted">{order.reference}</span>
              <OrderStatusBadge status={order.status} />
            </span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-body font-medium">{order.customer.name}</span>
              <span className="text-body font-medium whitespace-nowrap tabular-nums">
                {formatMoney(order.total, order.currency)}
              </span>
            </span>
            <span className="flex items-baseline justify-between gap-2 text-small text-ink-muted">
              <ItemsSummary order={order} />
              <span className="shrink-0">{placedLabel(order.placedAt)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
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
          <span className="h-3.5 w-32 animate-pulse rounded-sm bg-surface-sunken" />
          <span className="h-3.5 w-40 animate-pulse rounded-sm bg-surface-sunken" />
          <span className="ml-auto h-3.5 w-16 animate-pulse rounded-sm bg-surface-sunken" />
        </li>
      ))}
    </ul>
  );
}
