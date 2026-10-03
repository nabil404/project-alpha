import { HttpException } from '@nestjs/common';
import { DATE_FORMATS } from '@app/shared';
import { eq } from 'drizzle-orm';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  pgErrorOf,
  seedProduct,
  seedVariant,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedCustomer } from '../../database/__tests__/conversation-seeds';
import { seedOrder } from '../../database/__tests__/order-seeds';
import * as schema from '../../database/schema/index';
import { GeneralSettingsService } from '../general-settings.service';
import { MerchantSettingsRepository } from '../merchant-settings.repository';
import { seedRegionFromPhone } from '../region-from-phone';
import { ShopProfileRepository } from '../shop-profile.repository';

describe('merchant_settings date_format column', () => {
  it('matches the shared list', () => {
    expect(schema.merchantSettings.dateFormat.enumValues).toEqual([...DATE_FORMATS]);
  });
});

function codeOf(error: unknown): unknown {
  return error instanceof HttpException
    ? (error.getResponse() as { code?: string }).code
    : undefined;
}

// Runs as app_runtime, so row-level security applies exactly as in the api.
describeDb('GeneralSettingsService', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let service: GeneralSettingsService;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    service = new GeneralSettingsService(
      runtime.db,
      new MerchantSettingsRepository(),
      new ShopProfileRepository(),
    );
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  afterEach(async () => {
    for (const merchantId of [t.merchantA, t.merchantB]) {
      await t.db.delete(schema.orderItem).where(eq(schema.orderItem.merchantId, merchantId));
      await t.db.delete(schema.order).where(eq(schema.order.merchantId, merchantId));
      await t.db
        .delete(schema.merchantSettings)
        .where(eq(schema.merchantSettings.merchantId, merchantId));
    }
  });

  it('reads as the default region until the first save, without writing a row', async () => {
    const settings = await service.get(t.merchantA);

    expect(settings).toMatchObject({
      name: expect.stringMatching(/^Test /),
      logo: null,
      contactPhone: null,
      pickupAddress: null,
      country: 'BD',
      currency: 'BDT',
      timeZone: 'Asia/Dhaka',
      dateFormat: 'd MMM yyyy',
      currencyLocked: false,
    });
    const rows = await t.db
      .select()
      .from(schema.merchantSettings)
      .where(eq(schema.merchantSettings.merchantId, t.merchantA));
    expect(rows).toHaveLength(0);
  });

  it('saves the region and profile, leaving omitted fields alone', async () => {
    await service.update(t.merchantA, { contactPhone: '+8801812000000', name: "Rahim's Kitchen" });
    const saved = await service.update(t.merchantA, {
      country: 'US',
      currency: 'USD',
      timeZone: 'America/New_York',
      dateFormat: 'MMM d, yyyy',
    });

    expect(saved).toMatchObject({
      name: "Rahim's Kitchen",
      contactPhone: '+8801812000000',
      country: 'US',
      currency: 'USD',
      timeZone: 'America/New_York',
      dateFormat: 'MMM d, yyyy',
    });
    await expect(service.get(t.merchantA)).resolves.toEqual(saved);
  });

  it("never reads or changes another merchant's settings", async () => {
    await service.update(t.merchantA, { country: 'US', pickupAddress: 'A street' });
    const nameOfB = (await service.get(t.merchantB)).name;

    await expect(service.get(t.merchantB)).resolves.toMatchObject({
      country: 'BD',
      pickupAddress: null,
    });
    await service.update(t.merchantB, { country: 'IN', name: 'Shop B' });
    await expect(service.get(t.merchantA)).resolves.toMatchObject({
      country: 'US',
      pickupAddress: 'A street',
      name: expect.not.stringMatching('Shop B'),
    });
    expect(nameOfB).not.toBe('Shop B');
  });

  it('keeps every price its number when the decimals change', async () => {
    const product = await seedProduct(t.db, t.merchantA, { deliveryCharge: 6000 });
    const variant = await seedVariant(t.db, t.merchantA, product.id, { price: 160050 });
    const productOfB = await seedProduct(t.db, t.merchantB, { deliveryCharge: 6000 });
    const variantOfB = await seedVariant(t.db, t.merchantB, productOfB.id, { price: 160050 });

    await service.update(t.merchantA, { currency: 'JPY' });

    const [variantRow] = await t.db
      .select()
      .from(schema.productVariant)
      .where(eq(schema.productVariant.id, variant.id));
    const [productRow] = await t.db
      .select()
      .from(schema.product)
      .where(eq(schema.product.id, product.id));
    // ৳1,600.50 -> ¥1,601 and ৳60.00 -> ¥60; the revision moves so open editors refuse a stale save.
    expect(variantRow?.price).toBe(1601);
    expect(productRow).toMatchObject({ deliveryCharge: 60, revision: product.revision + 1 });

    const [untouched] = await t.db
      .select()
      .from(schema.productVariant)
      .where(eq(schema.productVariant.id, variantOfB.id));
    expect(untouched?.price).toBe(160050);
  });

  it('leaves prices alone between currencies with the same decimals', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const variant = await seedVariant(t.db, t.merchantA, product.id, { price: 150000 });

    await service.update(t.merchantA, { currency: 'INR' });

    const [row] = await t.db
      .select()
      .from(schema.productVariant)
      .where(eq(schema.productVariant.id, variant.id));
    expect(row?.price).toBe(150000);
  });

  it('fixes the currency once the shop has an order, and only for that shop', async () => {
    const customer = await seedCustomer(t.db, t.merchantA);
    await seedOrder(t.db, t.merchantA, customer.id);

    await expect(service.get(t.merchantA)).resolves.toMatchObject({ currencyLocked: true });
    const refused = await service.update(t.merchantA, { currency: 'USD' }).catch((e) => e);
    expect(codeOf(refused)).toBe('CURRENCY_LOCKED');
    await expect(service.get(t.merchantA)).resolves.toMatchObject({ currency: 'BDT' });

    // The same currency, and everything else, can still be saved.
    await expect(
      service.update(t.merchantA, { currency: 'BDT', timeZone: 'Asia/Kolkata' }),
    ).resolves.toMatchObject({ currency: 'BDT', timeZone: 'Asia/Kolkata' });

    await expect(service.update(t.merchantB, { currency: 'USD' })).resolves.toMatchObject({
      currency: 'USD',
      currencyLocked: false,
    });
  });

  it('refuses a phone that is not E.164 at the database too', async () => {
    await service.update(t.merchantA, { country: 'BD' });
    await expect(
      pgErrorOf(
        t.db
          .update(schema.merchantSettings)
          .set({ contactPhone: '01812-000000' })
          .where(eq(schema.merchantSettings.merchantId, t.merchantA)),
      ),
    ).resolves.toEqual({ code: '23514', constraint: 'merchant_settings_contact_phone_ck' });
  });
  describe('seedRegionFromPhone', () => {
    it("sets the region from the number's country", async () => {
      await expect(seedRegionFromPhone(runtime.db, t.merchantA, '+442071838750')).resolves.toBe(
        'GB',
      );
      await expect(service.get(t.merchantA)).resolves.toMatchObject({
        country: 'GB',
        currency: 'GBP',
        timeZone: 'Europe/London',
        contactPhone: null,
      });
    });

    it('never overwrites settings the shop already has', async () => {
      await service.update(t.merchantA, { country: 'IN', currency: 'INR' });

      await seedRegionFromPhone(runtime.db, t.merchantA, '+12125550123');

      await expect(service.get(t.merchantA)).resolves.toMatchObject({
        country: 'IN',
        currency: 'INR',
      });
    });

    it.each([
      ['no number', null],
      ['a number it cannot place', '01712-345678'],
    ])('leaves the default region for %s', async (_, phone) => {
      await expect(seedRegionFromPhone(runtime.db, t.merchantA, phone)).resolves.toBeNull();
      const rows = await t.db
        .select()
        .from(schema.merchantSettings)
        .where(eq(schema.merchantSettings.merchantId, t.merchantA));
      expect(rows).toHaveLength(0);
    });
  });
});
