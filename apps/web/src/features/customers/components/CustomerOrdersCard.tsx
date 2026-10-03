import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ListCustomerOrdersQuery } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { PaginationBar } from '@/components/PaginationBar';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { SHOP_CURRENCY } from '@/lib/currency';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import { orderReference, useOrderItemsLabel } from '../format';
import { useCustomerOrders } from '../queries';
import { OrderStatusBadge } from './OrderStatusBadge';

const ORDER_PAGE_SIZES = [10, 25, 50] as const;

/**
 * Every order the customer placed, newest first, cancelled ones included:
 * a table from `sm` up, a stack of rows below it. Not links yet, since there
 * is no order page to open.
 */
export function CustomerOrdersCard({ customerId }: { customerId: string }) {
  const { t } = useTranslation(['customers', 'common']);
  const { forError } = useErrorMessages();
  const { formatDate, formatMoney, formatNumber } = useFormatters();
  const itemsLabel = useOrderItemsLabel();
  const [query, setQuery] = useState<ListCustomerOrdersQuery>({
    page: 1,
    pageSize: ORDER_PAGE_SIZES[0],
  });
  const orders = useCustomerOrders(customerId, query);
  const pagination = orders.data?.pagination;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-baseline justify-between gap-4 px-4 pt-4 pb-3 sm:px-6">
        <h2 className="text-heading">{t('orders.title')}</h2>
        {pagination && (
          <span className="text-small text-ink-muted">
            {t('orders.count', {
              count: pagination.total,
              formatted: formatNumber(pagination.total),
            })}
          </span>
        )}
      </div>

      {orders.isError ? (
        <div className="flex flex-col items-start gap-3 border-t border-border px-4 py-6 sm:px-6">
          <ErrorBanner className="self-stretch">{forError(orders.error)}</ErrorBanner>
          <Button size="sm" onClick={() => void orders.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : orders.isPending ? (
        <div aria-hidden className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:px-6">
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="h-5 animate-pulse rounded-sm bg-surface-sunken" />
          ))}
        </div>
      ) : orders.data.data.length === 0 ? (
        <p className="border-t border-border px-4 py-8 text-center text-body text-ink-muted sm:px-6">
          {t('orders.empty')}
        </p>
      ) : (
        <div
          aria-busy={orders.isPlaceholderData || undefined}
          className={cn(
            'transition-opacity duration-200',
            orders.isPlaceholderData && 'opacity-60',
          )}
        >
          <ul className="sm:hidden">
            {orders.data.data.map((order) => (
              <li key={order.id} className="flex flex-col gap-1 border-t border-border px-4 py-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-code text-ink-muted">
                    {orderReference(order)}
                  </span>
                  <OrderStatusBadge status={order.status} />
                </span>
                <span className="flex justify-between gap-2 text-body">
                  <span className="min-w-0">{itemsLabel(order.items)}</span>
                  <span className="font-medium whitespace-nowrap tabular-nums">
                    {formatMoney(order.total, SHOP_CURRENCY)}
                  </span>
                </span>
                <span className="text-small text-ink-muted">
                  {formatDate(order.placedAt, 'dateTime')}
                </span>
              </li>
            ))}
          </ul>
          <div className="relative hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-label whitespace-nowrap text-ink-muted">
                  <th scope="col" className="border-t border-border py-3 pr-4 pl-6">
                    {t('orders.columns.order')}
                  </th>
                  <th scope="col" className="border-t border-border px-4 py-3">
                    {t('orders.columns.items')}
                  </th>
                  <th scope="col" className="border-t border-border px-4 py-3 text-right">
                    {t('orders.columns.total')}
                  </th>
                  <th scope="col" className="border-t border-border px-4 py-3">
                    {t('orders.columns.status')}
                  </th>
                  <th scope="col" className="border-t border-border py-3 pr-6 pl-4">
                    {t('orders.columns.placed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.data.data.map((order) => (
                  <tr key={order.id} className="border-t border-border">
                    <td className="py-3 pr-4 pl-6 font-mono text-code whitespace-nowrap text-ink-muted">
                      {orderReference(order)}
                    </td>
                    <td className="px-4 py-3 text-body">{itemsLabel(order.items)}</td>
                    <td className="px-4 py-3 text-right text-body whitespace-nowrap tabular-nums">
                      {formatMoney(order.total, SHOP_CURRENCY)}
                    </td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="py-3 pr-6 pl-4 text-small whitespace-nowrap text-ink-muted">
                      {formatDate(order.placedAt, 'dateTime')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <PaginationBar
          page={pagination.page}
          limit={pagination.pageSize}
          pageSizes={ORDER_PAGE_SIZES}
          totalPages={pagination.totalPages}
          summary={t('orders.showing', {
            from: formatNumber((pagination.page - 1) * pagination.pageSize + 1),
            to: formatNumber(Math.min(pagination.page * pagination.pageSize, pagination.total)),
            count: pagination.total,
            total: formatNumber(pagination.total),
          })}
          perPageLabel={t('orders.perPageLabel')}
          onPageChange={(page) => setQuery((prev) => ({ ...prev, page }))}
          onLimitChange={(pageSize) => setQuery({ page: 1, pageSize })}
        />
      )}
    </section>
  );
}
