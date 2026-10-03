import { isCountryCode, phoneCountryOf, regionDefaults } from '@app/shared';
import type { Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { MerchantSettingsRepository } from './merchant-settings.repository';

const settings = new MerchantSettingsRepository();

/**
 * Starts a new shop in the region of the phone its seller signed up with: a
 * +1 212 number opens in US dollars, New York time and month-first dates,
 * not the default Bangladesh. A shop that already has settings keeps them,
 * and a number with no known country (or no number - a social sign-up)
 * leaves the shop on the default region.
 *
 * The contact phone is not filled in: the seller's own number is not
 * necessarily the one they want customers to see.
 *
 * Returns the country it set, or null.
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
