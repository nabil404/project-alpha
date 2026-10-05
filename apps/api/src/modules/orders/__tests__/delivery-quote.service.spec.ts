import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  openRuntimeDb,
  seedProduct,
  seedVariant,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import * as schema from '../../database/schema/index';
import { ProductDeliveryRepository } from '../../products/product-delivery.repository';
import { DeliveryChargesRepository } from '../../settings/delivery-charges.repository';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { DeliveryQuoteService } from '../delivery-quote.service';
import { OrderCatalogRepository } from '../order-catalog.repository';

// Runs as app_runtime, so row-level security applies exactly as in the api.
describeDb('DeliveryQuoteService', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let service: DeliveryQuoteService;
  let dhakaId: string;
  let gazipurId: string;
  /** ৳1,000 a piece, shop charges. */
  let shopVariant: string;
  /** ৳1,000 a piece, ৳40 to Dhaka and no own charge for Gazipur. */
  let customVariant: string;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    service = new DeliveryQuoteService(
      runtime.db,
      new DeliveryChargesRepository(),
      new ProductDeliveryRepository(),
      new OrderCatalogRepository(),
      new MerchantSettingsRepository(),
    );

    const [dhaka, gazipur] = await t.db
      .insert(schema.deliveryCharge)
      .values([
        { merchantId: t.merchantA, areaName: 'Dhaka', charge: 6000, position: 0 },
        { merchantId: t.merchantA, areaName: 'Gazipur', charge: 8000, position: 1 },
      ])
      .returning();
    dhakaId = dhaka!.id;
    gazipurId = gazipur!.id;

    const shop = await seedProduct(t.db, t.merchantA);
    shopVariant = (await seedVariant(t.db, t.merchantA, shop.id, { price: 100000 })).id;
    const custom = await seedProduct(t.db, t.merchantA, { customDelivery: true });
    customVariant = (await seedVariant(t.db, t.merchantA, custom.id, { price: 100000 })).id;
    await t.db.insert(schema.productDeliveryCharge).values({
      merchantId: t.merchantA,
      productId: custom.id,
      deliveryChargeId: dhakaId,
      charge: 4000,
    });
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  afterEach(async () => {
    await t.db
      .delete(schema.merchantSettings)
      .where(eq(schema.merchantSettings.merchantId, t.merchantA));
  });

  const quote = (deliveryChargeId: string, variantIds: string[], merchantId = t.merchantA) =>
    service.quote(
      { merchantId },
      { deliveryChargeId, items: variantIds.map((variantId) => ({ variantId, quantity: 1 })) },
    );

  it('charges the highest of the products, not the sum', async () => {
    await expect(quote(dhakaId, [shopVariant, customVariant])).resolves.toEqual({
      fee: 6000,
      subtotal: 200000,
      freeDeliveryApplied: false,
    });
  });

  it('charges a lone custom product its own, cheaper, charge', async () => {
    await expect(quote(dhakaId, [customVariant])).resolves.toMatchObject({ fee: 4000 });
  });

  it('charges the shop charge where a custom product sets none', async () => {
    await expect(quote(gazipurId, [customVariant])).resolves.toMatchObject({ fee: 8000 });
  });

  it('is free once the subtotal reaches the threshold', async () => {
    await t.db.insert(schema.merchantSettings).values({
      merchantId: t.merchantA,
      country: 'BD',
      currency: 'BDT',
      timeZone: 'Asia/Dhaka',
      dateFormat: 'd MMM yyyy',
      freeDeliveryOver: 200000,
    });
    await expect(quote(dhakaId, [shopVariant, customVariant])).resolves.toEqual({
      fee: 0,
      subtotal: 200000,
      freeDeliveryApplied: true,
    });
  });

  it("refuses another merchant's area and an unknown variant", async () => {
    await expectCoded(quote(dhakaId, [shopVariant], t.merchantB), 'DELIVERY_CHARGE_NOT_FOUND');
    await expectCoded(quote(dhakaId, [randomUUID()]), 'VARIANT_NOT_FOUND');
  });
});
