import { useTranslation } from 'react-i18next';
import type { OrderDetail, OrderEvent } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { useFormatters } from '@/lib/format';

import { useOrderActivity } from '../queries';

/** What happened to the order, newest first, and who did it. */
export function OrderActivityCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation(['orders', 'common']);
  const { forError } = useErrorMessages();
  const { formatDate } = useFormatters();
  const activity = useOrderActivity(order.id);
  const describe = useEventDescription(order.currency);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-heading">{t('activity.title')}</h2>
      {activity.isError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorBanner className="self-stretch">{forError(activity.error)}</ErrorBanner>
          <Button size="sm" onClick={() => void activity.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : activity.isPending ? (
        <span aria-hidden className="h-24 animate-pulse rounded-md bg-surface-sunken" />
      ) : activity.data.length === 0 ? (
        // Orders from before the activity log have no events; their placing is all we know.
        <p className="text-small text-ink-muted">
          {t('activity.placed', { at: formatDate(order.placedAt, 'dateTime') })}
        </p>
      ) : (
        <ol className="flex flex-col">
          {activity.data.map((event) => {
            const { title, detail } = describe(event);
            return (
              <li
                key={event.id}
                className="relative flex flex-col gap-0.5 border-l border-border pb-4 pl-4 last:pb-0"
              >
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-1 size-2 rounded-full bg-border-strong"
                />
                <span className="text-body">{title}</span>
                {detail && <span className="text-small break-words text-ink-muted">{detail}</span>}
                <span className="text-small text-ink-muted">
                  {formatDate(event.createdAt, 'dateTime')}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** One event as a sentence and, where there is one, the detail under it. */
function useEventDescription(currency: string) {
  const { t } = useTranslation('orders');
  const { orderStatus, paymentStatus, paymentMethod } = useStatusLabels();
  const { formatList, formatMoney } = useFormatters();

  return (event: OrderEvent): { title: string; detail?: string } => {
    const who = event.actor?.name ?? t('activity.someone');
    const { data } = event;
    switch (data.type) {
      case 'created':
        return data.source === 'assistant'
          ? { title: t('activity.createdByAssistant') }
          : { title: t('activity.createdBySeller', { who }) };
      case 'status_changed':
        return {
          title: t('activity.statusChanged', { who, status: orderStatus(data.to) }),
          detail: data.note,
        };
      case 'items_changed':
        return {
          title: t('activity.itemsChanged', { who }),
          detail: t('activity.totalChanged', {
            before: formatMoney(data.totalBefore, currency),
            after: formatMoney(data.totalAfter, currency),
          }),
        };
      case 'delivery_changed':
        return {
          title: t('activity.deliveryChanged', { who }),
          detail: formatList(data.fields.map((field) => t(`activity.fields.${field}`))),
        };
      case 'payment_changed':
        return {
          title: data.status
            ? t('activity.paymentStatusChanged', { who, status: paymentStatus(data.status.to) })
            : t('activity.paymentMethodChanged', { who }),
          detail: data.method ? paymentMethod(data.method.to) : undefined,
        };
      case 'tracking_changed':
        return data.trackingNumber
          ? { title: t('activity.trackingSet', { who }), detail: data.trackingNumber }
          : { title: t('activity.trackingRemoved', { who }) };
    }
  };
}
