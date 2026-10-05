import { useTranslation } from 'react-i18next';

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
