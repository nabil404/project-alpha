import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OrderDetail, OrderStatus } from '@app/shared';

import { useStatusLabels } from '@/i18n/status-keys';
import { cn } from '@/lib/utils';

/** The lifecycle the stepper walks; cancelling and returning leave it, so they show as a note instead. */
const steps = [
  'new',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
] as const satisfies readonly OrderStatus[];
type Step = (typeof steps)[number];
const isStep = (status: OrderStatus): status is Step =>
  (steps as readonly string[]).includes(status);

/** Where the order is between drafted and delivered, and what each step asks of the seller. */
export function OrderProgress({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const { orderStatus } = useStatusLabels();

  if (!isStep(order.status)) {
    return (
      <p className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-body text-ink-muted">
        {order.status === 'cancelled' ? t('progress.cancelled') : t('progress.returned')}
      </p>
    );
  }

  const current = steps.indexOf(order.status);
  return (
    <ol
      aria-label={t('progress.label')}
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:grid-cols-5 sm:p-6"
    >
      {steps.map((step, index) => {
        const done = index < current;
        const here = index === current;
        return (
          <li
            key={step}
            aria-current={here ? 'step' : undefined}
            className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-label tabular-nums',
                done && 'border-accent bg-accent text-on-accent',
                here && 'border-accent text-accent',
                !done && !here && 'border-border text-ink-muted',
              )}
            >
              {done ? <Check aria-hidden strokeWidth={2} className="size-4" /> : index + 1}
            </span>
            <span className="flex flex-col">
              <span className={cn('text-body', here ? 'font-medium' : 'text-ink-muted')}>
                {orderStatus(step)}
              </span>
              <span className="text-small text-ink-muted">{t(`progress.steps.${step}`)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
