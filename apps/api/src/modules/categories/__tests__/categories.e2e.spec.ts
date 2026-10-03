import {
  Global,
  Module,
  type ExecutionContext,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { categorySchema, productSchema } from '@app/shared';
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
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { MailService } from '../../mail/mail.service';
import { ProductsModule } from '../../products/products.module';
import { ObjectStorage } from '../../storage/object-storage';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { CategoriesModule } from '../categories.module';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

/**
 * Over real HTTP with AuthModule mounted, as the product routes' spec does. The
 * app connects as app_runtime, so RLS applies; the tenant guard is stubbed to
 * a switchable merchant.
 */
describeDb('category routes over HTTP', () => {
  let app: INestApplication;
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let merchantId: string;
  const server = () => app.getHttpServer();
  /** Names are unique per merchant, so every test uses fresh ones. */
  const fresh = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

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
      imports: [TestInfrastructureModule, AuthModule, CategoriesModule, ProductsModule],
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

  const create = (name: string) => request(server()).post('/api/v1/categories').send({ name });

  it('creates, lists, renames and deletes', async () => {
    const name = fresh('Kids');
    const created = await create(`  ${name}  `).expect(201);
    const category = categorySchema.parse(created.body);
    expect(category.name).toBe(name);

    const listed = await request(server()).get('/api/v1/categories').expect(200);
    expect(listed.body).toContainEqual(category);

    const renamed = await request(server())
      .patch(`/api/v1/categories/${category.id}`)
      .send({ name: `${name} wear` })
      .expect(200);
    expect(renamed.body).toEqual({ id: category.id, name: `${name} wear` });

    await request(server()).delete(`/api/v1/categories/${category.id}`).expect(204);
    const after = await request(server()).get('/api/v1/categories').expect(200);
    expect(after.body.map((c: { id: string }) => c.id)).not.toContain(category.id);
  });

  it('answers a taken name with 409 CATEGORY_NAME_TAKEN, on create and rename', async () => {
    const name = fresh('Eid');
    await create(name).expect(201);
    const clash = await create(name.toUpperCase()).expect(409);
    expect(clash.body.error).toMatchObject({
      code: 'CATEGORY_NAME_TAKEN',
      params: { name: name.toUpperCase() },
    });

    const other = await create(fresh('Puja')).expect(201);
    const renameClash = await request(server())
      .patch(`/api/v1/categories/${other.body.id}`)
      .send({ name })
      .expect(409);
    expect(renameClash.body.error.code).toBe('CATEGORY_NAME_TAKEN');
  });

  it('frees the name of a deleted category', async () => {
    const name = fresh('Sale');
    const first = await create(name).expect(201);
    await request(server()).delete(`/api/v1/categories/${first.body.id}`).expect(204);
    await create(name).expect(201);
  });

  it('refuses a blank, overlong or missing name and a bad id with 400', async () => {
    for (const body of [{ name: '   ' }, { name: 'x'.repeat(81) }, {}]) {
      const res = await request(server()).post('/api/v1/categories').send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    await request(server()).patch('/api/v1/categories/not-a-uuid').send({ name: 'A' }).expect(400);
    await request(server()).delete('/api/v1/categories/not-a-uuid').expect(400);
  });

  it('answers a missing or deleted category with 404 CATEGORY_NOT_FOUND', async () => {
    const missing = randomUUID();
    const res = await request(server())
      .patch(`/api/v1/categories/${missing}`)
      .send({ name: fresh('Ghost') })
      .expect(404);
    expect(res.body.error).toMatchObject({ code: 'CATEGORY_NOT_FOUND', params: { id: missing } });

    const created = await create(fresh('Gone')).expect(201);
    await request(server()).delete(`/api/v1/categories/${created.body.id}`).expect(204);
    await request(server()).delete(`/api/v1/categories/${created.body.id}`).expect(404);
    await request(server())
      .patch(`/api/v1/categories/${created.body.id}`)
      .send({ name: fresh('Back') })
      .expect(404);
  });

  it('takes a deleted category off its products, leaving the products', async () => {
    const kept = categorySchema.parse((await create(fresh('Kept')).expect(201)).body);
    const dropped = categorySchema.parse((await create(fresh('Dropped')).expect(201)).body);
    const created = await request(server())
      .post('/api/v1/products')
      .send({
        name: 'Blue kurti',
        deliveryCharge: 6000,
        categoryIds: [kept.id, dropped.id],
        variants: [{ optionValues: [], price: 160000, stock: 9 }],
      })
      .expect(201);

    await request(server()).delete(`/api/v1/categories/${dropped.id}`).expect(204);

    const product = await request(server()).get(`/api/v1/products/${created.body.id}`).expect(200);
    expect(productSchema.parse(product.body).categoryIds).toEqual([kept.id]);
  });

  it("answers another merchant's category exactly as a missing one, and never lists it", async () => {
    const name = fresh('Private');
    const created = await create(name).expect(201);

    merchantId = t.merchantB;
    const listed = await request(server()).get('/api/v1/categories').expect(200);
    expect(listed.body.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
    const rename = await request(server())
      .patch(`/api/v1/categories/${created.body.id}`)
      .send({ name: fresh('Stolen') })
      .expect(404);
    expect(rename.body.error.code).toBe('CATEGORY_NOT_FOUND');
    await request(server()).delete(`/api/v1/categories/${created.body.id}`).expect(404);
    // Names are per merchant: B may use A's.
    await create(name).expect(201);

    merchantId = t.merchantA;
    const stillThere = await request(server()).get('/api/v1/categories').expect(200);
    expect(stillThere.body).toContainEqual({ id: created.body.id, name });
  });
});
