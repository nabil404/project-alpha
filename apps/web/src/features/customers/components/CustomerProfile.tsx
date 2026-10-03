import { Link } from '@tanstack/react-router';
import { ChevronRight, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CustomerDetail } from '@app/shared';

import { Button } from '@/components/ui/button';
import { CustomerAvatar, useCustomerName } from '@/features/conversations';
import { SHOP_CURRENCY } from '@/lib/currency';
import { useFormatters } from '@/lib/format';

import { ContactCard } from './ContactCard';
import { CustomerOrdersCard } from './CustomerOrdersCard';
import { CustomerStatusBadge } from './CustomerStatusBadge';
import { LatestConversationCard } from './LatestConversationCard';
import { NotesCard } from './NotesCard';

/**
 * One customer: their figures, orders and latest chat on the left, and what
 * the team keeps about them (contact details, notes) on the right. The two
 * columns stack below `lg`, the team's side last.
 */
export function CustomerProfile({ customer }: { customer: CustomerDetail }) {
  const { t } = useTranslation('customers');
  const customerName = useCustomerName();
  const { formatDate, formatMoney, formatNumber } = useFormatters();
  const name = customerName(customer.name);
  const since = t('detail.since', { date: formatDate(customer.createdAt, 'monthYear') });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <nav aria-label={t('detail.breadcrumb')}>
        <ol className="flex items-center gap-1 text-small text-ink-muted">
          <li className="shrink-0">
            <Link to="/customers" className="hover:text-ink">
              {t('list.title')}
            </Link>
          </li>
          <li aria-hidden className="flex">
            <ChevronRight strokeWidth={1.5} className="size-3.5" />
          </li>
          <li aria-current="page" className="min-w-0 truncate font-medium text-ink">
            {name}
          </li>
        </ol>
      </nav>

      <header className="flex flex-wrap items-center gap-4">
        <CustomerAvatar
          name={customer.name}
          pictureUrl={customer.pictureUrl}
          className="size-14 text-heading"
        />
        <div className="flex min-w-0 grow flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 text-display break-words">{name}</h1>
            <CustomerStatusBadge status={customer.status} />
          </div>
          <p className="text-small text-ink-muted">
            {customer.area ? t('detail.sinceInArea', { since, area: customer.area }) : since}
          </p>
        </div>
        {customer.latestConversation && (
          <Button asChild className="max-sm:grow">
            <Link
              to="/conversations/$conversationId"
              params={{ conversationId: customer.latestConversation.id }}
            >
              <MessageCircle aria-hidden strokeWidth={1.5} />
              {t('detail.openChat')}
            </Link>
          </Button>
        )}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {/*
            One row each below `sm`: Intl joins the currency and the amount
            with a no-break space, so a narrow column can't wrap "BDT 3,283.80".
          */}
          <div className="grid gap-2 sm:grid-cols-3 sm:gap-4">
            <Figure label={t('detail.figures.orders')} value={formatNumber(customer.orderCount)} />
            <Figure
              label={t('detail.figures.spent')}
              value={formatMoney(customer.totalSpent, SHOP_CURRENCY)}
            />
            <Figure
              label={t('detail.figures.average')}
              value={
                customer.averageOrderValue === null
                  ? t('summary.none')
                  : formatMoney(customer.averageOrderValue, SHOP_CURRENCY)
              }
            />
          </div>
          <CustomerOrdersCard customerId={customer.id} />
          <LatestConversationCard conversation={customer.latestConversation} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <ContactCard customer={customer} />
          <NotesCard customerId={customer.id} />
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-card sm:flex-col sm:items-start sm:gap-2 sm:p-6">
      <span className="text-label text-ink-muted">{label}</span>
      <span className="text-heading tabular-nums sm:text-stat">{value}</span>
    </div>
  );
}
