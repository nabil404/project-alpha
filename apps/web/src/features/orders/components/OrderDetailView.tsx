import { Link } from '@tanstack/react-router';
import { ChevronRight, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OrderDetail } from '@app/shared';

import { useCustomerName } from '@/features/conversations';
import { useFormatters } from '@/lib/format';

import { orderReference } from '../format';
import { DeliveryCard } from './DeliveryCard';
import { OrderActions } from './OrderActions';
import { OrderActivityCard } from './OrderActivityCard';
import { OrderConversationCard } from './OrderConversationCard';
import { OrderCustomerCard } from './OrderCustomerCard';
import { OrderItemsCard } from './OrderItemsCard';
import { OrderNoteCard } from './OrderNoteCard';
import { OrderProgress } from './OrderProgress';
import { OrderStatusBadge } from './OrderStatusBadge';
import { PaymentCard } from './PaymentCard';

/**
 * One order: its next step at the top, then what was ordered, how it is paid
 * and what happened to it on the left, and who it goes to on the right. The
 * columns stack below `lg`, the order's own side first.
 */
export function OrderDetailView({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const { formatDate } = useFormatters();
  const customerName = useCustomerName();
  const reference = orderReference(order);
  const placed = formatDate(order.placedAt, 'dateTime');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <nav aria-label={t('detail.breadcrumb')}>
        <ol className="flex items-center gap-1 text-small text-ink-muted">
          <li className="shrink-0">
            <Link to="/orders" className="hover:text-ink">
              {t('list.title')}
            </Link>
          </li>
          <li aria-hidden className="flex">
            <ChevronRight strokeWidth={1.5} className="size-3.5" />
          </li>
          <li aria-current="page" className="min-w-0 font-mono font-medium text-ink">
            {reference}
          </li>
        </ol>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-mono text-display break-all">{reference}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-small text-ink-muted">
            {order.source === 'assistant'
              ? t('detail.fromAssistant', { placed })
              : t('detail.fromSeller', { placed })}
          </p>
        </div>
        <OrderActions order={order} />
      </header>

      {order.status === 'new' && (
        <p className="flex items-start gap-3 rounded-lg border border-accent-soft bg-accent-soft px-4 py-3 text-body text-accent">
          <Info aria-hidden strokeWidth={1.5} className="mt-0.5 size-4 shrink-0" />
          {t('detail.checkBeforeConfirming', {
            name: customerName(order.customer.name ?? order.delivery.name),
          })}
        </p>
      )}

      <OrderProgress order={order} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <OrderItemsCard order={order} />
          <PaymentCard order={order} />
          <OrderActivityCard order={order} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <OrderCustomerCard order={order} />
          <DeliveryCard order={order} />
          {order.conversationId && <OrderConversationCard conversationId={order.conversationId} />}
          <OrderNoteCard order={order} />
        </div>
      </div>
    </div>
  );
}
