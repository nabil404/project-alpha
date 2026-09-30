import { randomUUID } from 'node:crypto';
import { createProductSchema } from '@app/shared';
import { sql } from 'drizzle-orm';
import type { ProductsService } from '../products.service';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { productsService } from './products-service.fixture';

// No orders table exists yet. A scratch table, created and removed by this
// suite, stands in for the first one that will point at variants, and so for
// the rule's real trigger. (A temporary table cannot reference product_variant.)
describeDb('ProductsService — remove', () => {
  let t: CatalogTestDb;
  let service: ProductsService;
  const table = sql.identifier(`test_order_line_${randomUUID().slice(0, 8)}`);

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = productsService(t.db);
    await t.db.execute(
      sql`CREATE TABLE ${table} ("merchant_id" text NOT NULL, "variant_id" text NOT NULL,
        FOREIGN KEY ("merchant_id", "variant_id") REFERENCES "product_variant" ("merchant_id", "id"))`,
    );
  });

  afterAll(async () => {
    await t.db.execute(sql`DROP TABLE IF EXISTS ${table}`);
    await t.close();
  });

  it('refuses with PRODUCT_IN_USE while a row points at one of its variants, and keeps it', async () => {
    const product = await service.create(
      t.merchantA,
      createProductSchema.parse({ name: 'Ordered', deliveryCharge: 0, variants: [{ price: 1 }] }),
    );
    await t.db.execute(
      sql`INSERT INTO ${table} VALUES (${t.merchantA}, ${product.variants[0]!.id})`,
    );

    await expectCoded(service.remove(t.merchantA, product.id), 'PRODUCT_IN_USE');
    await expect(service.get(t.merchantA, product.id)).resolves.toMatchObject({ id: product.id });

    await t.db.execute(sql`DELETE FROM ${table}`);
  });

  it('deletes a product nothing points at', async () => {
    const product = await service.create(
      t.merchantA,
      createProductSchema.parse({ name: 'Free', deliveryCharge: 0, variants: [{ price: 1 }] }),
    );
    await service.remove(t.merchantA, product.id);
    await expectCoded(service.get(t.merchantA, product.id), 'PRODUCT_NOT_FOUND');
  });
});
