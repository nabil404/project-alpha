import { eq } from 'drizzle-orm';
import type { SaveDeliverySettings } from '@app/shared';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  openRuntimeDb,
  seedProduct,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedCustomer } from '../../database/__tests__/conversation-seeds';
import { seedOrder } from '../../database/__tests__/order-seeds';
import * as schema from '../../database/schema/index';
import { DeliveryChargesRepository } from '../delivery-charges.repository';
import { DeliverySettingsService } from '../delivery-settings.service';
import { MerchantSettingsRepository } from '../merchant-settings.repository';

// Runs as app_runtime, so row-level security applies exactly as in the api.
describeDb('DeliverySettingsService', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let service: DeliverySettingsService;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    service = new DeliverySettingsService(
      runtime.db,
      new DeliveryChargesRepository(),
      new MerchantSettingsRepository(),
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
        .delete(schema.productDeliveryCharge)
        .where(eq(schema.productDeliveryCharge.merchantId, merchantId));
      await t.db
        .delete(schema.deliveryCharge)
        .where(eq(schema.deliveryCharge.merchantId, merchantId));
      await t.db
        .delete(schema.merchantSettings)
        .where(eq(schema.merchantSettings.merchantId, merchantId));
    }
  });

  const doc = (
    deliveryCharges: SaveDeliverySettings['deliveryCharges'],
    extra: Partial<SaveDeliverySettings> = {},
  ): SaveDeliverySettings => ({
    deliveryCharges,
    everywhereElse: { charge: 12000, deliveryTime: '3–5 days' },
    freeDeliveryOver: null,
    ...extra,
  });
  const dhaka = { areaName: 'Dhaka', charge: 6000, deliveryTime: '1–2 days' };
  const gazipur = { areaName: 'Gazipur', charge: 8000, deliveryTime: null };

  it('reads a shop that never saved as empty, in its currency', async () => {
    await expect(service.get(t.merchantA)).resolves.toEqual({
      currency: 'BDT',
      deliveryCharges: [],
      everywhereElse: null,
      freeDeliveryOver: null,
    });
  });

  it('saves the page and reads it back in the order listed', async () => {
    const saved = await service.save(
      t.merchantA,
      doc([gazipur, dhaka], { freeDeliveryOver: 300000 }),
    );

    expect(saved.deliveryCharges.map((row) => row.areaName)).toEqual(['Gazipur', 'Dhaka']);
    expect(saved).toMatchObject({
      everywhereElse: { charge: 12000, deliveryTime: '3–5 days' },
      freeDeliveryOver: 300000,
    });
    await expect(service.get(t.merchantA)).resolves.toEqual(saved);
  });

  it('keeps listed ids, adds new rows and removes the rest; the fallback keeps its id', async () => {
    const first = await service.save(t.merchantA, doc([dhaka, gazipur]));
    const dhakaId = first.deliveryCharges[0]!.id;

    const next = await service.save(
      t.merchantA,
      doc([
        { ...dhaka, id: dhakaId, charge: 7000 },
        { areaName: 'Savar', charge: 9000, deliveryTime: null },
      ]),
    );

    expect(next.deliveryCharges).toMatchObject([
      { id: dhakaId, areaName: 'Dhaka', charge: 7000 },
      { areaName: 'Savar' },
    ]);
    expect(next.everywhereElse?.id).toBe(first.everywhereElse?.id);
  });

  it('swaps two names in one save', async () => {
    const {
      deliveryCharges: [a, b],
    } = await service.save(t.merchantA, doc([dhaka, gazipur]));

    const swapped = await service.save(
      t.merchantA,
      doc([
        { ...dhaka, id: a!.id, areaName: 'Gazipur' },
        { ...gazipur, id: b!.id, areaName: 'Dhaka' },
      ]),
    );

    expect(swapped.deliveryCharges.map((row) => [row.id, row.areaName])).toEqual([
      [a!.id, 'Gazipur'],
      [b!.id, 'Dhaka'],
    ]);
  });

  it("refuses another merchant's id and leaves their row alone", async () => {
    const {
      deliveryCharges: [a],
    } = await service.save(t.merchantA, doc([dhaka]));

    await expectCoded(
      service.save(t.merchantB, doc([{ ...dhaka, id: a!.id, areaName: 'Stolen' }])),
      'DELIVERY_CHARGE_NOT_FOUND',
    );
    await expect(service.get(t.merchantA)).resolves.toMatchObject({
      deliveryCharges: [{ areaName: 'Dhaka' }],
    });
  });

  it('removing an area unlinks its orders and drops product charges for it', async () => {
    const {
      deliveryCharges: [a],
    } = await service.save(t.merchantA, doc([dhaka]));
    const product = await seedProduct(t.db, t.merchantA, { customDelivery: true });
    await t.db.insert(schema.productDeliveryCharge).values({
      merchantId: t.merchantA,
      productId: product.id,
      deliveryChargeId: a!.id,
      charge: 9000,
    });
    const customer = await seedCustomer(t.db, t.merchantA);
    const order = await seedOrder(t.db, t.merchantA, customer.id, {
      deliveryChargeId: a!.id,
      deliveryArea: 'Dhaka',
    });

    await service.save(t.merchantA, doc([]));

    const [row] = await t.db.select().from(schema.order).where(eq(schema.order.id, order.id));
    expect(row).toMatchObject({ deliveryChargeId: null, deliveryArea: 'Dhaka' });
    const charges = await t.db
      .select()
      .from(schema.productDeliveryCharge)
      .where(eq(schema.productDeliveryCharge.productId, product.id));
    expect(charges).toHaveLength(0);
  });

  it("never shows one shop the other's page", async () => {
    await service.save(t.merchantA, doc([dhaka], { freeDeliveryOver: 1 }));

    await expect(service.get(t.merchantB)).resolves.toMatchObject({
      deliveryCharges: [],
      everywhereElse: null,
      freeDeliveryOver: null,
    });
    // The same name is fine in another shop.
    await expect(service.save(t.merchantB, doc([dhaka]))).resolves.toBeDefined();
  });
});
