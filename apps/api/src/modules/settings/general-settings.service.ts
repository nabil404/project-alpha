import { Inject, Injectable } from '@nestjs/common';
import {
  currencyDecimals,
  DEFAULT_COUNTRY,
  regionDefaults,
  type GeneralSettings,
  type UpdateGeneralSettings,
} from '@app/shared';
import { CodedConflictException } from '../../common/errors/coded-exceptions';
import type { TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import {
  MerchantSettingsRepository,
  type MerchantSettingsValues,
} from './merchant-settings.repository';
import { ShopProfileRepository, type ShopProfileRow } from './shop-profile.repository';

/** What a shop that has never saved its region reads as. */
export function defaultMerchantSettings(): MerchantSettingsValues {
  const { currency, timeZone, dateFormat } = regionDefaults(DEFAULT_COUNTRY);
  return {
    country: DEFAULT_COUNTRY,
    currency,
    timeZone,
    dateFormat,
    contactPhone: null,
    pickupAddress: null,
  };
}

/**
 * The factor that keeps a price's number when the currency's decimals change:
 * "100" from JPY (0) to BDT (2), "0.01" back. Null when they are the same.
 * A string, so Postgres multiplies in exact numeric.
 */
export function rescaleFactor(from: string, to: string): string | null {
  const shift = currencyDecimals(to) - currencyDecimals(from);
  if (shift === 0) return null;
  return shift > 0 ? `1${'0'.repeat(shift)}` : `0.${'0'.repeat(-shift - 1)}1`;
}

function toGeneralSettings(
  profile: ShopProfileRow,
  settings: MerchantSettingsValues,
  currencyLocked: boolean,
): GeneralSettings {
  return {
    name: profile.name,
    logo: profile.logo,
    contactPhone: settings.contactPhone ?? null,
    pickupAddress: settings.pickupAddress ?? null,
    country: settings.country,
    currency: settings.currency,
    timeZone: settings.timeZone,
    dateFormat: settings.dateFormat,
    currencyLocked,
  };
}

/**
 * Settings > General. A shop has no settings row until its first save and
 * reads as the default region until then.
 *
 * The currency is what every price and order of the shop is stored in, so it
 * may change only until the first order. A change before then keeps each
 * price's number, rescaling the stored minor units when the two currencies
 * have different decimals; nothing is converted at an exchange rate.
 */
@Injectable()
export class GeneralSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: MerchantSettingsRepository,
    private readonly profiles: ShopProfileRepository,
  ) {}

  get(merchantId: string): Promise<GeneralSettings> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope: TenantScope = { merchantId };
      const profile = await this.profiles.find(tx, scope);
      const row = await this.settings.find(tx, scope);
      const locked = await this.settings.hasOrders(tx, scope);
      return toGeneralSettings(profile, row ?? defaultMerchantSettings(), locked);
    });
  }

  update(merchantId: string, input: UpdateGeneralSettings): Promise<GeneralSettings> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope: TenantScope = { merchantId };
      const { name, ...changes } = input;
      const current = await this.settings.lockOrCreate(tx, scope, defaultMerchantSettings());
      const locked = await this.settings.hasOrders(tx, scope);

      if (changes.currency !== undefined && changes.currency !== current.currency) {
        if (locked) {
          throw new CodedConflictException(
            'CURRENCY_LOCKED',
            'The shop has orders in its current currency',
            { currency: current.currency },
          );
        }
        const factor = rescaleFactor(current.currency, changes.currency);
        if (factor) await this.settings.rescaleAmounts(tx, scope, factor);
      }

      const row =
        Object.keys(changes).length > 0 ? await this.settings.update(tx, scope, changes) : current;
      if (name !== undefined) await this.profiles.rename(tx, scope, name);
      return toGeneralSettings(await this.profiles.find(tx, scope), row, locked);
    });
  }
}
