import { createContext, useContext } from 'react';
import { DEFAULT_COUNTRY, regionDefaults, type DateFormat } from '@app/shared';

/**
 * The shop's region, as every money amount and date in the dashboard needs
 * it. Settings > General owns the values; `ShopRegionProvider` in
 * features/settings fills this from that query for signed-in pages.
 */
export interface ShopRegion {
  country: string;
  /** ISO 4217: what every price and order of the shop is in. */
  currency: string;
  /** IANA zone dates are read in, whatever the viewer's machine says. */
  timeZone: string;
  dateFormat: DateFormat;
}

const defaults = regionDefaults(DEFAULT_COUNTRY);

/** What a page outside the signed-in shell, or one still loading settings, renders with. */
export const DEFAULT_SHOP_REGION: ShopRegion = {
  country: DEFAULT_COUNTRY,
  currency: defaults.currency,
  timeZone: defaults.timeZone,
  dateFormat: defaults.dateFormat,
};

export const ShopRegionContext = createContext<ShopRegion>(DEFAULT_SHOP_REGION);

export function useShopRegion(): ShopRegion {
  return useContext(ShopRegionContext);
}
