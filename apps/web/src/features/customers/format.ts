import { useTranslation } from 'react-i18next';
import type { CustomerOrder } from '@app/shared';

import { useFormatters } from '@/lib/format';

const RELATIVE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Today", "3 days ago" for the last week, then the date: "12 Aug". A
 * customer who never ordered reads "No orders yet".
 */
export function useLastOrderLabel() {
  const { t } = useTranslation('customers');
  const { formatDate, formatRelativeDay } = useFormatters();

  return (lastOrderAt: string | null, now: Date = new Date()): string => {
    if (lastOrderAt === null) return t('list.noOrdersYet');
    const label =
      now.getTime() - new Date(lastOrderAt).getTime() < RELATIVE_DAYS * DAY_MS
        ? formatRelativeDay(lastOrderAt, now)
        : formatDate(lastOrderAt, 'dayMonth');
    return label.charAt(0).toLocaleUpperCase() + label.slice(1);
  };
}

/**
 * ORD-2026-00481: the shop's order number, zero-padded, after the year it was
 * placed. An identifier, not a quantity, so it is never locale-grouped.
 */
export function orderReference({ number, placedAt }: Pick<CustomerOrder, 'number' | 'placedAt'>) {
  return `ORD-${new Date(placedAt).getFullYear()}-${String(number).padStart(5, '0')}`;
}

/** "Blue kurti, M × 2, Dupatta × 1". */
export function useOrderItemsLabel() {
  const { t } = useTranslation('customers');
  const { formatList } = useFormatters();

  return (items: CustomerOrder['items']): string =>
    formatList(
      items.map(({ productName, variantName, quantity }) =>
        variantName
          ? t('orders.itemWithVariant', { product: productName, variant: variantName, quantity })
          : t('orders.item', { product: productName, quantity }),
      ),
    );
}
