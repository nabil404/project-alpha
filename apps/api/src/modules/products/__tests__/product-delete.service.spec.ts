import { createProductSchema } from '@app/shared';
import type { ProductsService } from '../products.service';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedCustomer } from '../../database/__tests__/conversation-seeds';
import { seedOrder } from '../../database/__tests__/order-seeds';
import { productsService } from './products-service.fixture';

describeDb('ProductsService — remove', () => {
  let t: CatalogTestDb;
  let service: ProductsService;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = productsService(t.db);
  });

  afterAll(async () => {
    await t.close();
  });

  it('refuses with PRODUCT_IN_USE while an order line points at one of its variants, and keeps it', async () => {
    const product = await service.create(
      t.merchantA,
      createProductSchema.parse({ name: 'Ordered', variants: [{ price: 1 }] }),
    );
    const customer = await seedCustomer(t.db, t.merchantA);
    await seedOrder(t.db, t.merchantA, customer.id, {
      items: [{ productName: 'Ordered', variantId: product.variants[0]!.id }],
    });
    await expectCoded(service.remove(t.merchantA, product.id), 'PRODUCT_IN_USE');
    await expect(service.get(t.merchantA, product.id)).resolves.toMatchObject({ id: product.id });
  });

  it('deletes a product nothing points at', async () => {
    const product = await service.create(
      t.merchantA,
      createProductSchema.parse({ name: 'Free', variants: [{ price: 1 }] }),
    );
    await service.remove(t.merchantA, product.id);
    await expectCoded(service.get(t.merchantA, product.id), 'PRODUCT_NOT_FOUND');
  });
});
