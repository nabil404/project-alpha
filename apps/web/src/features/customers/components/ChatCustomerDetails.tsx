import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Phone, ShoppingBag, UserRound } from 'lucide-react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { useCustomerName } from '@/features/conversations';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';

import { useCustomer } from '../queries';

/** Who the seller is talking to, beside a chat: name, phone, address and what they have ordered. */
export function ChatCustomerDetails({ customerId }: { customerId: string }) {
  const { t } = useTranslation('customers');
  const { forError } = useErrorMessages();
  const { formatMoney } = useFormatters();
  const customerName = useCustomerName();
  const customer = useCustomer(customerId);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-heading">{t('chat.title')}</h2>
      {customer.isError ? (
        <ErrorBanner>{forError(customer.error)}</ErrorBanner>
      ) : !customer.data ? (
        <div aria-busy className="h-32" />
      ) : (
        <dl className="flex flex-col gap-3">
          <DetailLine icon={<UserRound />} label={t('chat.name')}>
            {customerName(customer.data.name)}
          </DetailLine>
          <DetailLine icon={<Phone />} label={t('contact.phone')}>
            {customer.data.phone}
          </DetailLine>
          <DetailLine icon={<MapPin />} label={t('contact.deliveryAddress')}>
            {customer.data.deliveryAddress}
          </DetailLine>
          <DetailLine icon={<ShoppingBag />} label={t('detail.figures.orders')}>
            {customer.data.orderCount === 0
              ? t('list.noOrdersYet')
              : t('chat.orders', {
                  count: customer.data.orderCount,
                  spent: formatMoney(customer.data.totalSpent),
                })}
          </DetailLine>
        </dl>
      )}
    </section>
  );
}

/** The label is for screen readers; the icon says it to everyone else. */
function DetailLine({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: string | null;
}) {
  const { t } = useTranslation('customers');

  return (
    <div className="flex items-start gap-2">
      <dt className="flex pt-1 text-ink-muted [&_svg]:size-4 [&_svg]:stroke-[1.5]">
        <span aria-hidden className="flex">
          {icon}
        </span>
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 text-body break-words whitespace-pre-line">
        {children ?? <span className="text-ink-muted">{t('contact.notAdded')}</span>}
      </dd>
    </div>
  );
}
