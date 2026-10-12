import { and, eq } from 'drizzle-orm';
import { CategoriesRepository } from '../../../src/modules/categories/categories.repository';
import { CategoriesService } from '../../../src/modules/categories/categories.service';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../src/modules/database/__tests__/catalog-test-db';
import { seedCustomer } from '../../../src/modules/database/__tests__/conversation-seeds';
import { seedOrder } from '../../../src/modules/database/__tests__/order-seeds';
import type { Database } from '../../../src/modules/database/database.module';
import * as schema from '../../../src/modules/database/schema/index';
import { productsService } from '../../../src/modules/products/__tests__/products-service.fixture';
import { DeliveryChargesRepository } from '../../../src/modules/settings/delivery-charges.repository';
import { ProductSeeder, SeedTargetError } from '../product-seeder';
import { SEED_CATEGORIES, SEED_PRODUCTS, taka } from '../seed-catalog';

const SEEDED = SEED_PRODUCTS.length;

describeDb('ProductSeeder, as app_runtime', () => {
  let t: CatalogTestDb;
  let runtime: { db: Database; close(): Promise<void> };
  let seeder: ProductSeeder;

  const productsOf = (merchantId: string) =>
    t.db.select().from(schema.product).where(eq(schema.product.merchantId, merchantId));

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    seeder = new ProductSeeder(
      runtime.db,
      productsService(runtime.db),
      new CategoriesService(runtime.db, new CategoriesRepository()),
      new DeliveryChargesRepository(),
    );
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('finds a shop by slug, and names the shops when the slug matches none', async () => {
    const [own] = await t.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, t.merchantA));
    await expect(seeder.findOrganization(own!.slug)).resolves.toMatchObject({ id: t.merchantA });

    const missing = seeder.findOrganization('no-such-shop');
    await expect(missing).rejects.toThrow(SeedTargetError);
    await expect(missing).rejects.toThrow(own!.slug);
  });

  it('seeds the catalog once: a second run creates nothing and touches no other shop', async () => {
    const first = await seeder.run(t.merchantA, { count: 0, reset: false });
    expect(first).toMatchObject({ created: SEEDED, skipped: 0, filler: 0 });

    const second = await seeder.run(t.merchantA, { count: 0, reset: false });
    expect(second).toMatchObject({ created: 0, skipped: SEEDED, filler: 0 });

    expect(await productsOf(t.merchantA)).toHaveLength(SEEDED);
    expect(await productsOf(t.merchantB)).toHaveLength(0);
    const categories = await t.db
      .select({ name: schema.category.name })
      .from(schema.category)
      .where(eq(schema.category.merchantId, t.merchantA));
    expect(categories.map((c) => c.name).sort()).toEqual([...SEED_CATEGORIES].sort());
  });

  it('continues the filler numbering on the next run', async () => {
    await seeder.run(t.merchantA, { count: 3, reset: false });
    await seeder.run(t.merchantA, { count: 2, reset: false });

    const numbers = (await productsOf(t.merchantA))
      .map((p) => /#(\d+)$/.exec(p.name)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it("prices a custom-delivery product's areas off the shop's charges", async () => {
    const [area] = await t.db
      .insert(schema.deliveryCharge)
      .values({ merchantId: t.merchantB, areaName: 'dhaka', charge: taka(70), position: 0 })
      .returning();
    await seeder.run(t.merchantB, { count: 0, reset: false });

    const [saree] = await t.db
      .select()
      .from(schema.product)
      .where(
        and(eq(schema.product.merchantId, t.merchantB), eq(schema.product.name, 'Jamdani Saree')),
      );
    expect(saree?.customDelivery).toBe(true);
    const charges = await t.db
      .select()
      .from(schema.productDeliveryCharge)
      .where(eq(schema.productDeliveryCharge.productId, saree!.id));
    expect(charges).toMatchObject([{ deliveryChargeId: area!.id, charge: taka(70 + 60) }]);
  });

  it('resets only its own shop, keeping a product an order points at', async () => {
    const [ordered] = await t.db
      .select({ id: schema.productVariant.id, productId: schema.productVariant.productId })
      .from(schema.productVariant)
      .innerJoin(schema.product, eq(schema.product.id, schema.productVariant.productId))
      .where(
        and(eq(schema.product.merchantId, t.merchantA), eq(schema.product.name, 'Cotton Lungi')),
      );
    const customer = await seedCustomer(t.db, t.merchantA);
    await seedOrder(t.db, t.merchantA, customer.id, { items: [{ variantId: ordered!.id }] });
    const before = (await productsOf(t.merchantA)).length;
    const otherShop = (await productsOf(t.merchantB)).length;

    const summary = await seeder.run(t.merchantA, { count: 0, reset: true });

    expect(summary).toMatchObject({ removed: before - 1, keptInUse: 1 });
    // The kept product's name is taken, so the catalog comes back one short.
    expect(summary.created + summary.skipped).toBe(SEEDED);
    expect(summary.skipped).toBe(1);
    expect((await productsOf(t.merchantA)).map((p) => p.id)).toContain(ordered!.productId);
    expect(await productsOf(t.merchantB)).toHaveLength(otherShop);
  });
});
