import { Link } from '@tanstack/react-router';
import { Check, ChevronRight, Sparkle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { canTransitionOrder } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';

import { useLineLabel } from '../format';
import { useChangeOrderStatus, useOrder } from '../queries';
import { useAreaLabel } from './AreaField';
import { OrderStatusBadge } from './OrderStatusBadge';

/**
 * The order a chat produced last, beside it. A drafted one offers the
 * seller's own Confirm, the second confirmation after the customer's in
 * Messenger; editing it, or anything later, happens on its order page.
 */
export function ChatOrderSummary({ orderId }: { orderId: string }) {
  const { t } = useTranslation('orders');
  const { forError } = useErrorMessages();
  const { formatMoney } = useFormatters();
  const { paymentMethod } = useStatusLabels();
  const lineLabel = useLineLabel();
  const areaLabel = useAreaLabel();
  const toast = useToast();
  const order = useOrder(orderId);
  const change = useChangeOrderStatus(orderId);

  if (order.isError) return <ErrorBanner>{forError(order.error)}</ErrorBanner>;
  if (!order.data) return <div aria-busy className="h-64" />;

  const detail = order.data;
  const money = (amount: number) => formatMoney(amount, detail.currency);
  const drafted = detail.status === 'new';
  const area = areaLabel(detail.delivery);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-heading">{drafted ? t('chat.drafted') : t('chat.latest')}</h2>
        <OrderStatusBadge status={detail.status} />
      </div>
      <span className="font-mono text-small text-ink-muted">{detail.reference}</span>

      <dl className="flex flex-col gap-2 rounded-md bg-surface-sunken p-4 text-body">
        {detail.items.map((item) => (
          <div key={item.id} className="flex justify-between gap-3">
            <dt className="min-w-0 text-ink-muted">{lineLabel(item)}</dt>
            <dd className="shrink-0 tabular-nums">{money(item.lineTotal)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3">
          <dt className="min-w-0 text-ink-muted">
            {area ? t('totals.deliveryInArea', { area }) : t('totals.delivery')}
          </dt>
          <dd className="shrink-0 tabular-nums">{money(detail.deliveryFee)}</dd>
        </div>
        <div className="my-1 h-px bg-border" />
        <div className="flex justify-between gap-3 font-semibold">
          <dt>{t('totals.total')}</dt>
          <dd className="shrink-0 tabular-nums">{money(detail.total)}</dd>
        </div>
      </dl>

      <dl className="flex justify-between gap-3 text-body">
        <dt className="text-ink-muted">{t('chat.payment')}</dt>
        <dd>{paymentMethod(detail.paymentMethod)}</dd>
      </dl>

      <div className="flex flex-col gap-2">
        {drafted && canTransitionOrder(detail.status, 'confirmed') && (
          <Button
            variant="primary"
            className="max-xl:h-11"
            disabled={change.isPending}
            onClick={() =>
              change.mutate(
                { status: 'confirmed', version: detail.version },
                {
                  onSuccess: () => toast.success(t('actions.confirmed.done')),
                  onError: (error) => toast.error(error),
                },
              )
            }
          >
            <Check aria-hidden strokeWidth={1.5} />
            {t('actions.confirmed.label')}
          </Button>
        )}
        <Button asChild className="max-xl:h-11">
          <Link to="/orders/$orderId" params={{ orderId: detail.id }}>
            {drafted ? t('chat.edit') : t('chat.view')}
          </Link>
        </Button>
      </div>
      {drafted && detail.source === 'assistant' && (
        <p className="text-small text-ink-muted">{t('chat.customerConfirmed')}</p>
      )}
    </section>
  );
}

/**
 * Above the reply box on narrower screens, while the chat's order waits for
 * the seller: opens the chat's Details to review and confirm it.
 */
export function ChatOrderBanner({
  conversationId,
  orderId,
}: {
  conversationId: string;
  orderId: string;
}) {
  const { t } = useTranslation('orders');
  const { formatMoney } = useFormatters();
  const order = useOrder(orderId);
  if (order.data?.status !== 'new') return null;

  return (
    <div className="bg-bg px-4 pb-2 xl:hidden">
      <Link
        to="/conversations/$conversationId/details"
        params={{ conversationId }}
        search={(prev) => prev}
        className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-ink hover:bg-surface-hover"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Sparkle aria-hidden className="size-4.5" strokeWidth={1.5} />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="text-body font-medium">
            {t('chat.banner', { total: formatMoney(order.data.total, order.data.currency) })}
          </span>
          <span className="text-small text-ink-muted">{t('chat.bannerHint')}</span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-muted" strokeWidth={1.5} />
      </Link>
    </div>
  );
}
