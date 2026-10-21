import { useTranslation } from 'react-i18next';
import { shopDayStart, type ImportRun } from '@app/shared';

import { useFormatters } from '@/lib/format';
import { useShopRegion } from '@/lib/shop-region';

/** "1 Jul 2026 – 21 Oct 2026": a run's dates are shop days, so they are read in the shop's zone. */
export function useRangeLabel() {
  const { t } = useTranslation('catalog');
  const { formatDate } = useFormatters();
  const { timeZone } = useShopRegion();

  return ({ since, until }: Pick<ImportRun, 'since' | 'until'>) =>
    t('imports.range', {
      since: formatDate(shopDayStart(since, timeZone)),
      until: formatDate(shopDayStart(until, timeZone)),
    });
}
