import { Inject, Injectable } from '@nestjs/common';
import {
  currencyDecimals,
  DEFAULT_COUNTRY,
  regionDefaults,
  type GeneralSettings,
  type UpdateGeneralSettings,
} from '@app/shared';
import { CodedConflictException } from '../../common/errors/coded-exceptions';
import { languageFor } from '../conversations/assistant/assistant-fallbacks';
import type { TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { FacebookPageRepository } from '../messenger/page/facebook-page.repository';
import { MessengerProfileSync } from '../messenger/profile/messenger-profile.sync';
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
    freeDeliveryOver: null,
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
 * Settings > General. Until its first save, a shop has no row and uses the
 * default region. The currency may change only before the first order. A change
 * keeps each price's number, rescaling minor units if the decimals differ, and
 * converts nothing at an exchange rate.
 */
@Injectable()
export class GeneralSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: MerchantSettingsRepository,
    private readonly profiles: ShopProfileRepository,
    private readonly pages: FacebookPageRepository,
    private readonly profileSync: MessengerProfileSync,
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

  /**
   * The Page's greeting and ice breakers default to the shop's language, so a
   * country that changes it asks for a profile sync, after the commit.
   */
  async update(merchantId: string, input: UpdateGeneralSettings): Promise<GeneralSettings> {
    const { result, languageChanged } = await withMerchant(this.db, merchantId, async (tx) => {
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
      return {
        result: toGeneralSettings(await this.profiles.find(tx, scope), row, locked),
        languageChanged: languageFor(current.country) !== languageFor(row.country),
      };
    });

    if (languageChanged) {
      const page = await withMerchant(this.db, merchantId, (tx) =>
        this.pages.findForMerchant(tx, { merchantId }),
      );
      if (page) await this.profileSync.request(merchantId);
    }
    return result;
  }
}
