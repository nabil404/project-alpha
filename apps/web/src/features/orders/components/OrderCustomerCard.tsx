import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { OrderDetail } from '@app/shared';

import { CustomerAvatar, useCustomerName } from '@/features/conversations';
import { useFormatters } from '@/lib/format';

/** Who ordered: the customer as they are now, and how much they had bought before this order. */
export function OrderCustomerCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const customerName = useCustomerName();
  const { formatMoney, formatNumber } = useFormatters();
  const { customer } = order;
  const name = customerName(customer.name ?? order.delivery.name);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-heading">{t('customer.title')}</h2>
        <Link
          to="/customers/$customerId"
          params={{ customerId: customer.id }}
          className="text-small font-medium text-link underline-offset-4 hover:underline"
        >
          {t('customer.viewProfile')}
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <CustomerAvatar name={customer.name} pictureUrl={customer.pictureUrl} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-body font-medium">{name}</span>
          <span className="text-small text-ink-muted">
            {customer.earlierOrderCount === 0
              ? t('customer.firstOrder')
              : t('customer.earlierOrders', {
                  count: customer.earlierOrderCount,
                  formatted: formatNumber(customer.earlierOrderCount),
                })}
          </span>
        </div>
      </div>
      {customer.earlierOrderCount > 0 && (
        <p className="text-small text-ink-muted">
          {t('customer.spentBefore', { amount: formatMoney(customer.spentBefore, order.currency) })}
        </p>
      )}
    </section>
  );
}
