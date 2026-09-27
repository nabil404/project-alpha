import { randomUUID } from 'node:crypto';
import {
  Global,
  Module,
  type ExecutionContext,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { productImageSchema } from '@app/shared';
import sharp from 'sharp';
import request from 'supertest';
import { AuthModule } from '../../../../auth/auth.module';
import { configureApp, NEST_APP_OPTIONS } from '../../../../bootstrap';
import { TenantGuard } from '../../../../common/tenant.guard';
import { AppConfig } from '../../../../config/app.config';
import { DATABASE } from '../../../../database/database.module';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  seedProduct,
  type CatalogTestDb,
} from '../../../../database/__tests__/catalog-test-db';
import { MailService } from '../../../mail/mail.service';
import { ObjectStorage } from '../../../storage/object-storage';
import { InMemoryObjectStorage } from '../../../storage/__tests__/in-memory-object-storage';
import { ProductsModule } from '../../products.module';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

/**
 * Over real HTTP with AuthModule mounted, because AuthModule owns body parsing
 * (Nest's parser is off): this proves multipart reaches multer intact beside
 * Better Auth's JSON parser. The app connects as app_runtime, so RLS applies.
 * The tenant guard is stubbed to a switchable merchant; session handling has
 * its own e2e spec.
 */
describeDb('product image routes over HTTP', () => {
  let app: INestApplication;
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let merchantId: string;
  let productId: string;
  const storage = new InMemoryObjectStorage();
  const server = () => app.getHttpServer();
  const imagesPath = () => `/api/v1/products/${productId}/images`;
  const jpeg = () =>
    sharp({ create: { width: 40, height: 30, channels: 3, background: '#48c' } })
      .jpeg()
      .toBuffer();

  beforeAll(async () => {
    t = await openCatalogTestDb();
    productId = (await seedProduct(t.db, t.merchantA)).id;

    runtime = openRuntimeDb();
    const env: Record<string, string> = {
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
      .useValue(storage)
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

  it('uploads, reorders and deletes', async () => {
    const first = await request(server())
      .post(imagesPath())
      .attach('file', await jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(productImageSchema.parse(first.body)).toMatchObject({
      position: 0,
      width: 40,
      height: 30,
    });

    const second = await request(server())
      .post(imagesPath())
      .attach('file', await jpeg(), 'b.jpg')
      .expect(201);

    const reordered = await request(server())
      .put(`${imagesPath()}/order`)
      .send({ imageIds: [second.body.id, first.body.id] })
      .expect(200);
    expect(reordered.body.map((image: { id: string }) => image.id)).toEqual([
      second.body.id,
      first.body.id,
    ]);

    await request(server()).delete(`${imagesPath()}/${first.body.id}`).expect(204);
    await request(server()).delete(`${imagesPath()}/${second.body.id}`).expect(204);
    expect(storage.objects.size).toBe(0);
  });

  it('answers VALIDATION_FAILED on the file field when no file is sent', async () => {
    const response = await request(server())
      .post(imagesPath())
      .field('note', 'no file')
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.fields.file[0].code).toBe('REQUIRED');
  });

  it('answers PRODUCT_IMAGE_INVALID for a file under another field name', async () => {
    const response = await request(server())
      .post(imagesPath())
      .attach('photo', await jpeg(), 'a.jpg')
      .expect(400);

    expect(response.body.error.code).toBe('PRODUCT_IMAGE_INVALID');
  });

  it('answers PRODUCT_IMAGE_INVALID for two files and stores nothing', async () => {
    const before = storage.objects.size;

    const response = await request(server())
      .post(imagesPath())
      .attach('file', await jpeg(), 'a.jpg')
      .attach('file', await jpeg(), 'b.jpg')
      .expect(400);

    expect(response.body.error.code).toBe('PRODUCT_IMAGE_INVALID');
    expect(storage.objects.size).toBe(before);
  });

  it('answers PRODUCT_IMAGE_TOO_LARGE over 10 MB', async () => {
    const response = await request(server())
      .post(imagesPath())
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'big.jpg')
      .expect(413);

    expect(response.body.error).toMatchObject({
      code: 'PRODUCT_IMAGE_TOO_LARGE',
      params: { maxBytes: 10 * 1024 * 1024 },
    });
  });

  it('answers VALIDATION_FAILED for a product id that is not a uuid', async () => {
    const response = await request(server())
      .post('/api/v1/products/not-a-uuid/images')
      .attach('file', await jpeg(), 'a.jpg')
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it("answers PRODUCT_NOT_FOUND for an unknown product and for another merchant's, storing nothing", async () => {
    const unknown = await request(server())
      .post(`/api/v1/products/${randomUUID()}/images`)
      .attach('file', await jpeg(), 'a.jpg')
      .expect(404);
    expect(unknown.body.error.code).toBe('PRODUCT_NOT_FOUND');

    merchantId = t.merchantB;
    const before = storage.objects.size;
    const foreign = await request(server())
      .post(imagesPath())
      .attach('file', await jpeg(), 'a.jpg')
      .expect(404);
    expect(foreign.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(storage.objects.size).toBe(before);
  });
});
