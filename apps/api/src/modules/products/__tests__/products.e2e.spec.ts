import {
  Global,
  Module,
  type ExecutionContext,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { productSchema } from '@app/shared';
import request from 'supertest';
import { AuthModule } from '../../auth/auth.module';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
import { TenantGuard } from '../../../common/tenant.guard';
import { AppConfig } from '../../config/app.config';
import { DATABASE } from '../../database/database.module';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  seedCategory,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { MailService } from '../../mail/mail.service';
import { ObjectStorage } from '../../storage/object-storage';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { ProductsModule } from '../products.module';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

/**
 * Over real HTTP with AuthModule mounted, as the image routes' spec does. The
 * app connects as app_runtime, so RLS applies; the tenant guard is stubbed to
 * a switchable merchant.
 */
describeDb('product routes over HTTP', () => {
  let app: INestApplication;
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let merchantId: string;
  const server = () => app.getHttpServer();

  const newProduct = {
    name: 'Blue kurti',
    deliveryCharge: 6000,
    options: [{ name: 'Size', values: [{ value: 'M' }, { value: 'L' }] }],
    variants: [
      { optionValues: ['M'], price: 160000, stock: 9 },
      { optionValues: ['L'], price: 160000, stock: 7 },
    ],
  };

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    };

    @Global()
    @Module({
      providers: [
        { provide: DATABASE, useValue: runtime.db },
        { provide: AppConfig, useValue: { get: (key: string) => env[key] } },
      ],
      exports: [DATABASE, AppConfig],
    })
    class TestInfrastructureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestInfrastructureModule, AuthModule, ProductsModule],
    })
      .overrideProvider(MailService)
      .useValue({ dispatch: () => {} })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ merchantId?: string }>().merchantId = merchantId;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication({
      ...NEST_APP_OPTIONS,
      bufferLogs: false,
      logger: false,
    });
    configureApp(app, silentLogger);
    await app.init();
  });

  beforeEach(() => {
    merchantId = t.merchantA;
  });

  afterAll(async () => {
    await app?.close();
    await runtime?.close();
    await t.close();
  });

  it('creates, reads, saves with a new option, and deletes', async () => {
    const created = await request(server()).post('/api/v1/products').send(newProduct).expect(201);
    const product = productSchema.parse(created.body);
    expect(product.variants.map((v) => v.name)).toEqual(['M', 'L']);

    await request(server()).get(`/api/v1/products/${product.id}`).expect(200);

    const saved = await request(server())
      .put(`/api/v1/products/${product.id}`)
      .send({
        version: product.version,
        name: product.name,
        deliveryCharge: product.deliveryCharge,
        options: [
          { id: product.options[0]!.id, name: 'Size', values: product.options[0]!.values },
          { name: 'Sleeve', values: [{ value: 'Short' }, { value: 'Long' }] },
        ],
        variants: [
          { id: product.variants[0]!.id, optionValues: ['M', 'Short'], price: 160000, stock: 5 },
          { optionValues: ['M', 'Long'], price: 160000, stock: 4 },
        ],
      })
      .expect(200);
    expect(productSchema.parse(saved.body).variants.map((v) => v.name)).toEqual([
      'M / Short',
      'M / Long',
    ]);

    await request(server()).delete(`/api/v1/products/${product.id}`).expect(204);
    await request(server()).get(`/api/v1/products/${product.id}`).expect(404);
  });

  it('patches the status', async () => {
    const created = await request(server()).post('/api/v1/products').send(newProduct).expect(201);
    const patched = await request(server())
      .patch(`/api/v1/products/${created.body.id}`)
      .send({ status: 'active' })
      .expect(200);
    expect(patched.body.status).toBe('active');
  });

  it('refuses a stale save with 409 PRODUCT_STALE', async () => {
    const created = await request(server()).post('/api/v1/products').send(newProduct).expect(201);
    await request(server())
      .patch(`/api/v1/products/${created.body.id}`)
      .send({ name: 'Renamed' })
      .expect(200);

    const stale = await request(server())
      .put(`/api/v1/products/${created.body.id}`)
      .send({ ...newProduct, version: created.body.version })
      .expect(409);
    expect(stale.body.error.code).toBe('PRODUCT_STALE');
  });

  it('reports document rule failures per field', async () => {
    const created = await request(server()).post('/api/v1/products').send(newProduct).expect(201);
    const invalid = await request(server())
      .put(`/api/v1/products/${created.body.id}`)
      .send({
        ...newProduct,
        version: created.body.version,
        options: [...newProduct.options, { name: 'size', values: [{ value: 'X' }] }],
      })
      .expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    expect(invalid.body.error.fields['options.1.name'][0].code).toBe('DUPLICATE');
  });

  it("answers another merchant's product exactly as a missing one", async () => {
    const created = await request(server()).post('/api/v1/products').send(newProduct).expect(201);
    merchantId = t.merchantB;
    const path = `/api/v1/products/${created.body.id}`;
    await request(server()).get(path).expect(404);
    await request(server()).patch(path).send({ status: 'archived' }).expect(404);
    await request(server())
      .put(path)
      .send({ ...newProduct, version: created.body.version })
      .expect(404);
    await request(server()).delete(path).expect(404);
  });

  it('patches one variant, which makes an older save stale', async () => {
    const created = await request(server()).post('/api/v1/products').send(newProduct).expect(201);
    const variantId = created.body.variants[1].id;

    const patched = await request(server())
      .patch(`/api/v1/products/${created.body.id}/variants/${variantId}`)
      .send({ stock: 2, price: 150000 })
      .expect(200);
    expect(productSchema.parse(patched.body).variants[1]).toMatchObject({
      id: variantId,
      stock: 2,
      price: 150000,
    });

    await request(server())
      .put(`/api/v1/products/${created.body.id}`)
      .send({ ...newProduct, version: created.body.version })
      .expect(409);
  });

  it("refuses a variant patch for a missing variant, bad fields, or another merchant's product", async () => {
    const created = await request(server()).post('/api/v1/products').send(newProduct).expect(201);
    const path = `/api/v1/products/${created.body.id}/variants`;
    const variantId = created.body.variants[0].id;

    await request(server()).patch(`${path}/${created.body.id}`).send({ stock: 1 }).expect(404);
    const invalid = await request(server())
      .patch(`${path}/${variantId}`)
      .send({ stock: -1 })
      .expect(400);
    expect(invalid.body.error.fields.stock[0].code).toBe('MIN_VALUE');

    merchantId = t.merchantB;
    await request(server()).patch(`${path}/${variantId}`).send({ stock: 1 }).expect(404);
  });

  it('refuses a malformed id with 400', async () => {
    await request(server()).get('/api/v1/products/not-a-uuid').expect(400);
  });

  it("lists only the merchant's own categories", async () => {
    const own = await seedCategory(t.db, t.merchantA);
    const theirs = await seedCategory(t.db, t.merchantB);
    const listed = await request(server()).get('/api/v1/categories').expect(200);
    const ids = listed.body.map((category: { id: string }) => category.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(theirs.id);
  });
});
