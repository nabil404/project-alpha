import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CUSTOMER_STATS_WINDOW_DAYS, REPEAT_MIN_ORDERS, type CustomerSummary } from '@app/shared';

import { SHOP_CURRENCY } from '@/lib/currency';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The four figures over the list. The repeat rate is of customers who have
 * ordered, not of everyone who messaged: a shop's browsers would otherwise
 * drag it down without saying anything about whether buyers come back.
 */
export function CustomerSummaryCards({ summary }: { summary: CustomerSummary | undefined }) {
  const { t } = useTranslation('customers');
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

  const { counts, newInWindow, repeatCustomers, customersWithOrders, averageOrderValue } = summary;
  const { allTime, currentWindow, previousWindow } = averageOrderValue;
  const change =
    currentWindow !== null && previousWindow !== null && previousWindow > 0
      ? currentWindow / previousWindow - 1
      : null;

  // Two across only from `sm`: an amount can't wrap (Intl joins "BDT" to it
  // with a no-break space), and half a phone is too narrow for a large one.
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
      <StatCard
        label={t('summary.total.label')}
        value={formatNumber(counts.all)}
        detail={
          newInWindow > 0 ? (
            <Trend direction="up">
              {t('summary.total.new', {
                count: newInWindow,
                formatted: formatNumber(newInWindow),
                days: CUSTOMER_STATS_WINDOW_DAYS,
              })}
            </Trend>
          ) : (
            t('summary.total.noneNew', { days: CUSTOMER_STATS_WINDOW_DAYS })
          )
        }
      />
      <StatCard
        label={t('summary.repeat.label')}
        value={
          customersWithOrders > 0
            ? formatPercent(repeatCustomers / customersWithOrders)
            : t('summary.none')
        }
        detail={
          customersWithOrders > 0
            ? t('summary.repeat.detail', {
                count: customersWithOrders,
                repeat: formatNumber(repeatCustomers),
                buyers: formatNumber(customersWithOrders),
                min: REPEAT_MIN_ORDERS,
              })
            : t('summary.repeat.noOrders')
        }
      />
      <StatCard
        label={t('summary.average.label')}
        value={allTime === null ? t('summary.none') : formatMoney(allTime, SHOP_CURRENCY)}
        detail={
          change === null ? (
            t('summary.average.allTime')
          ) : (
            <Trend direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}>
              {t('summary.average.change', {
                change: formatPercent(change, { signed: true }),
                days: CUSTOMER_STATS_WINDOW_DAYS,
              })}
            </Trend>
          )
        }
      />
      <StatCard
        label={t('summary.needsYou.label')}
        value={formatNumber(counts.needsYou)}
        detail={
          <Link
            to="/conversations"
            search={{ filter: 'needs_you' }}
            className="text-link underline-offset-4 hover:underline"
          >
            {t('summary.needsYou.link')}
          </Link>
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
