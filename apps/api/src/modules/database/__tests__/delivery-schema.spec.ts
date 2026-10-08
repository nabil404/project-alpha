import { eq, sql } from 'drizzle-orm';
import * as schema from '../schema/index';
import { withMerchant } from '../with-merchant';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  pgErrorOf,
  seedProduct,
  type CatalogTestDb,
} from './catalog-test-db';
import { seedCustomer } from './conversation-seeds';
import { seedOrder } from './order-seeds';

describeDb('delivery_charge and product_delivery_charge tables', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
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
    }
  });

  const area = async (
    merchantId: string,
    values: Partial<typeof schema.deliveryCharge.$inferInsert> = {},
  ) => {
    const [row] = await t.db
      .insert(schema.deliveryCharge)
      .values({ merchantId, areaName: 'Dhaka', charge: 6000, position: 0, ...values })
      .returning();
    if (!row) throw new Error('no delivery_charge row');
    return row;
  };

  it('refuses a second area with the same name in another case', async () => {
    await area(t.merchantA);
    const error = await pgErrorOf(area(t.merchantA, { areaName: 'dhaka', position: 1 }));
    expect(error.constraint).toBe(schema.DELIVERY_CHARGE_AREA_UIDX);
  });

  it('holds one nameless fallback per shop', async () => {
    await area(t.merchantA, { areaName: null, isFallback: true });
    const error = await pgErrorOf(area(t.merchantA, { areaName: null, isFallback: true }));
    expect(error.constraint).toBe(schema.DELIVERY_CHARGE_FALLBACK_UIDX);
    await expect(area(t.merchantB, { areaName: null, isFallback: true })).resolves.toBeDefined();
  });

  it('gives a name to every row but the fallback', async () => {
    const nameless = await pgErrorOf(area(t.merchantA, { areaName: null }));
    expect(nameless.constraint).toBe('delivery_charge_area_name_ck');
    const namedFallback = await pgErrorOf(area(t.merchantA, { areaName: 'X', isFallback: true }));
    expect(namedFallback.constraint).toBe('delivery_charge_area_name_ck');
  });

  it("hides another merchant's rows from app_runtime", async () => {
    await area(t.merchantA);
    const seen = await withMerchant(runtime.db, t.merchantB, (tx) =>
      tx.select().from(schema.deliveryCharge),
    );
    expect(seen).toHaveLength(0);
  });

  it('removing an area unlinks its orders, keeping snapshots, and deletes its product charges', async () => {
    const dhaka = await area(t.merchantA, { deliveryTime: '1–2 days' });
    const product = await seedProduct(t.db, t.merchantA, { customDelivery: true });
    await t.db.insert(schema.productDeliveryCharge).values({
      merchantId: t.merchantA,
      productId: product.id,
      deliveryChargeId: dhaka.id,
      charge: 9000,
    });
    const customer = await seedCustomer(t.db, t.merchantA);
    const order = await seedOrder(t.db, t.merchantA, customer.id, {
      deliveryChargeId: dhaka.id,
      deliveryArea: 'Dhaka',
      deliveryTime: '1–2 days',
    });

    await t.db.delete(schema.deliveryCharge).where(eq(schema.deliveryCharge.id, dhaka.id));

    const [row] = await t.db.select().from(schema.order).where(eq(schema.order.id, order.id));
    expect(row).toMatchObject({
      deliveryChargeId: null,
      deliveryArea: 'Dhaka',
      deliveryTime: '1–2 days',
    });
    const charges = await t.db
      .select()
      .from(schema.productDeliveryCharge)
      .where(eq(schema.productDeliveryCharge.productId, product.id));
    expect(charges).toHaveLength(0);
  });

  it("refuses links to another merchant's area", async () => {
    const theirs = await area(t.merchantB);
    const customer = await seedCustomer(t.db, t.merchantA);
    const orderError = await pgErrorOf(
      seedOrder(t.db, t.merchantA, customer.id, { deliveryChargeId: theirs.id }),
    );
    expect(orderError.constraint).toBe('order_delivery_charge_fk');

    const product = await seedProduct(t.db, t.merchantA);
    const productError = await pgErrorOf(
      t.db.insert(schema.productDeliveryCharge).values({
        merchantId: t.merchantA,
        productId: product.id,
        deliveryChargeId: theirs.id,
        charge: 1,
      }),
    );
    expect(productError.constraint).toBe('product_delivery_charge_delivery_charge_fk');
  });

  it('refuses a negative charge', async () => {
    const error = await pgErrorOf(area(t.merchantA, { charge: -1 }));
    expect(error.constraint).toBe('delivery_charge_charge_ck');
  });

  it('forces row-level security on both tables', async () => {
    const { rows } = await t.db.execute<{ relname: string; force: boolean }>(sql`
      select relname, relforcerowsecurity as force from pg_class
      where relname in ('delivery_charge', 'product_delivery_charge') order by relname`);
    expect(rows).toEqual([
      { relname: 'delivery_charge', force: true },
      { relname: 'product_delivery_charge', force: true },
    ]);
  });
});
