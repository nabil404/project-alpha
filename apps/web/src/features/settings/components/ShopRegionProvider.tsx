import { useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dashboardLocaleSchema, defaultDashboardLocale } from '@app/shared';

import { sessionQueryOptions } from '@/features/auth';
import { DEFAULT_SHOP_REGION, ShopRegionContext, type ShopRegion } from '@/lib/shop-region';

import { generalSettingsQueryOptions } from '../queries';

/**
 * Gives every signed-in page the shop's currency, time zone and date format,
 * and puts the dashboard in the signed-in person's language: theirs if they
 * picked one, else the first of the shop's country's languages it speaks.
 * Until settings load, pages render with the default region.
 */
export function ShopRegionProvider({ children }: { children: ReactNode }) {
  const settings = useQuery(generalSettingsQueryOptions());
  const session = useQuery(sessionQueryOptions());
  const { i18n } = useTranslation();

  const region = useMemo<ShopRegion>(
    () =>
      settings.data
        ? {
            country: settings.data.country,
            currency: settings.data.currency,
            timeZone: settings.data.timeZone,
            dateFormat: settings.data.dateFormat,
          }
        : DEFAULT_SHOP_REGION,
    [settings.data],
  );

  const chosen = dashboardLocaleSchema.safeParse(session.data?.user.locale).data;
  const language = chosen ?? (settings.data ? defaultDashboardLocale(settings.data.country) : null);

  useEffect(() => {
    // Compared on the base language, so a browser's 'en-GB' - which Intl uses
    // for date and number conventions - is not flattened to 'en'.
    if (language && i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
  }, [i18n, language]);

  return <ShopRegionContext.Provider value={region}>{children}</ShopRegionContext.Provider>;
}
