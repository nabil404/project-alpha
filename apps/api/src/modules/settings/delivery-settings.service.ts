import { Inject, Injectable } from '@nestjs/common';
import type { DeliverySettings, SaveDeliverySettings } from '@app/shared';
import type { Executor, TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { DeliveryChargesRepository } from './delivery-charges.repository';
import { deliveryChargeNotFound } from './delivery-errors';
import { defaultMerchantSettings } from './general-settings.service';
import { MerchantSettingsRepository } from './merchant-settings.repository';

/**
 * Settings > Delivery charges, saved as one page under the shop's settings
 * row lock, so two saves - or a save and a currency change - cannot
 * interleave. The last save wins, as on Settings > General.
 */
@Injectable()
export class DeliverySettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly charges: DeliveryChargesRepository,
    private readonly settings: MerchantSettingsRepository,
  ) {}

  get(merchantId: string): Promise<DeliverySettings> {
    return withMerchant(this.db, merchantId, (tx) => this.read(tx, { merchantId }));
  }

  save(merchantId: string, input: SaveDeliverySettings): Promise<DeliverySettings> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      await this.settings.lockOrCreate(tx, scope, defaultMerchantSettings());
      const current = await this.charges.list(tx, scope);
      const named = new Set(current.filter((row) => !row.isFallback).map((row) => row.id));
      for (const row of input.deliveryCharges) {
        if (row.id && !named.has(row.id)) throw deliveryChargeNotFound(row.id);
      }

      const kept = input.deliveryCharges.flatMap((row) => (row.id ? [row.id] : []));
      await this.charges.deleteNamedExcept(tx, scope, kept);
      // Two phases, so swapping names never trips the unique index mid-save:
      // park kept rows behind a control character (refused in real names),
      // then write the real ones.
      for (const id of kept) {
        await this.charges.update(tx, scope, id, { areaName: `\u0001${id}` });
      }
      for (const [position, row] of input.deliveryCharges.entries()) {
        if (!row.id) continue;
        await this.charges.update(tx, scope, row.id, {
          areaName: row.areaName,
          charge: row.charge,
          deliveryTime: row.deliveryTime,
          position,
        });
      }
      await this.charges.insert(
        tx,
        scope,
        input.deliveryCharges.flatMap((row, position) =>
          row.id
            ? []
            : [
                {
                  areaName: row.areaName,
                  isFallback: false,
                  charge: row.charge,
                  deliveryTime: row.deliveryTime,
                  position,
                },
              ],
        ),
      );

      const fallback = current.find((row) => row.isFallback);
      const everywhereElse = {
        charge: input.everywhereElse.charge,
        deliveryTime: input.everywhereElse.deliveryTime,
        position: 0,
      };
      if (fallback) await this.charges.update(tx, scope, fallback.id, everywhereElse);
      else {
        await this.charges.insert(tx, scope, [
          { ...everywhereElse, areaName: null, isFallback: true },
        ]);
      }

      await this.settings.update(tx, scope, { freeDeliveryOver: input.freeDeliveryOver });
      return this.read(tx, scope);
    });
  }

  private async read(tx: Executor, scope: TenantScope): Promise<DeliverySettings> {
    const settings = (await this.settings.find(tx, scope)) ?? defaultMerchantSettings();
    const rows = await this.charges.list(tx, scope);
    const fallback = rows.find((row) => row.isFallback);
    return {
      currency: settings.currency,
      deliveryCharges: rows
        .filter((row) => !row.isFallback)
        .map((row) => ({
          id: row.id,
          areaName: row.areaName ?? '',
          charge: row.charge,
          deliveryTime: row.deliveryTime,
        })),
      everywhereElse: fallback
        ? { id: fallback.id, charge: fallback.charge, deliveryTime: fallback.deliveryTime }
        : null,
      freeDeliveryOver: settings.freeDeliveryOver ?? null,
    };
  }
}
