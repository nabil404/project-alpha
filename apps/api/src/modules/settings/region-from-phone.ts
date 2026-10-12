import { isCountryCode, phoneCountryOf, regionDefaults } from '@app/shared';
import type { Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { MerchantSettingsRepository } from './merchant-settings.repository';

const settings = new MerchantSettingsRepository();

/**
 * Sets a new shop's region from the seller's sign-up phone, so a +1 212 number
 * opens in US dollars, New York time and month-first dates. A shop that already
 * has settings keeps them. No phone, or one with no known country, leaves the
 * default region. The contact phone stays empty, since the seller may want
 * customers to use a different number. Returns the country it set, or null.
 */
export async function seedRegionFromPhone(
  db: Database,
  merchantId: string,
  phone: string | null | undefined,
): Promise<string | null> {
  const country = phone ? phoneCountryOf(phone) : null;
  if (!country || !isCountryCode(country)) {
    return null;
  }
  const { currency, timeZone, dateFormat } = regionDefaults(country);
  await withMerchant(db, merchantId, (tx) =>
    settings.insertIfAbsent(
      tx,
      { merchantId },
      { country, currency, timeZone, dateFormat, contactPhone: null, pickupAddress: null },
    ),
  );
  return country;
}
