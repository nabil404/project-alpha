import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ORDER_STATS_WINDOW_DAYS, type OrderSummary } from '@app/shared';

import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The four figures over the list. They ignore its search and dates: what
 * waits for the seller waits whatever they are looking at.
 */
export function OrderSummaryCards({ summary }: { summary: OrderSummary | undefined }) {
  const { t } = useTranslation('orders');
  const { formatMoney, formatNumber, formatPercent } = useFormatters();

  if (!summary) {
    return (
      <div aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-lg bg-surface-sunken" />
        ))}
      </div>
    );
  }

  const { awaitingConfirmation, toShip, revenue, placedInWindow } = summary;
  const days = ORDER_STATS_WINDOW_DAYS;
  const change =
    revenue.previousWindow > 0 ? revenue.currentWindow / revenue.previousWindow - 1 : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
      <StatCard
        label={t('summary.awaiting.label')}
        value={formatNumber(awaitingConfirmation)}
        detail={t('summary.awaiting.detail')}
      />
      <StatCard
        label={t('summary.toShip.label')}
        value={formatNumber(toShip.confirmed + toShip.packed)}
        detail={t('summary.toShip.detail', {
          confirmed: formatNumber(toShip.confirmed),
          packed: formatNumber(toShip.packed),
        })}
      />
      <StatCard
        label={t('summary.revenue.label', { days })}
        value={formatMoney(revenue.currentWindow)}
        detail={
          change === null ? (
            t('summary.revenue.noPrevious', { days })
          ) : (
            <Trend direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}>
              {t('summary.revenue.change', {
                change: formatPercent(change, { signed: true }),
                days,
              })}
            </Trend>
          )
        }
      />
      <StatCard
        label={t('summary.assistant.label')}
        value={
          placedInWindow.all > 0
            ? formatPercent(placedInWindow.byAssistant / placedInWindow.all)
            : t('summary.none')
        }
        detail={
          placedInWindow.all > 0
            ? t('summary.assistant.detail', { days })
            : t('summary.assistant.noOrders', { days })
        }
      />
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface p-4 shadow-card sm:gap-2 lg:p-6">
      <span className="text-label text-ink-muted">{label}</span>
      <span className="text-stat tabular-nums">{value}</span>
      <span className="text-small text-ink-muted">{detail}</span>
    </div>
  );
}

/** Green going up, red going down; the words carry the direction too. */
function Trend({
  direction,
  children,
}: {
  direction: 'up' | 'down' | 'flat';
  children: ReactNode;
}) {
  const Icon = direction === 'down' ? TrendingDown : TrendingUp;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        direction === 'up' && 'text-success',
        direction === 'down' && 'text-danger',
      )}
    >
      {direction !== 'flat' && <Icon aria-hidden strokeWidth={1.5} className="size-4" />}
      {children}
    </span>
  );
}
