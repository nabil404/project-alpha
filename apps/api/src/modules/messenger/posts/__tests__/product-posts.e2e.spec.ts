import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { pagePostListResponseSchema, productPostListResponseSchema } from '@app/shared';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { configureApp, NEST_APP_OPTIONS } from '../../../../bootstrap';
import { listenOnLoopback } from '../../../../__tests__/listen-on-loopback';
import { describeDb, testDatabaseUrl } from '../../../../__tests__/test-env';
import { CryptoService } from '../../../../common/crypto.service';
import { CapturingMailer } from '../../../auth/__tests__/capturing-mailer';
import { AuthModule } from '../../../auth/auth.module';
import { SessionGuard } from '../../../auth/session.guard';
import { AppConfig } from '../../../config/app.config';
import { seedProduct } from '../../../database/__tests__/catalog-test-db';
import { seedFacebookPage } from '../../../database/__tests__/conversation-seeds';
import { DATABASE, type Database } from '../../../database/database.module';
import * as schema from '../../../database/schema/index';
import { MailService } from '../../../mail/mail.service';
import { FacebookPageModule } from '../../page/facebook-page.module';
import { FacebookPageRepository } from '../../page/facebook-page.repository';
import { META_GRAPH } from '../../page/facebook-page.tokens';
import { GraphError, type GraphPost } from '../../page/meta-graph.client';
import { ProductPostsModule } from '../product-posts.module';
import { POST_LINK_FETCH } from '../shared-post.resolver';

// Needs a real Postgres: sessions come from Better Auth.
const url = testDatabaseUrl;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';
const KEY = Buffer.alloc(32, 7).toString('base64');
const crypto = new CryptoService({ get: () => KEY } as unknown as AppConfig);

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

/** Graph as the routes see it: posts by Graph id, and each Page's recent posts. */
const graphPosts = new Map<string, GraphPost>();
let graphRefuses = false;
const fakeGraph = {
  getPost: (_token: string, id: string) =>
    graphRefuses
      ? Promise.reject(new GraphError(403, 10, 'no permission'))
      : Promise.resolve(graphPosts.get(id) ?? null),
  listPagePosts: (_token: string, pageId: string) =>
    graphRefuses
      ? Promise.reject(new GraphError(403, 10, 'no permission'))
      : Promise.resolve(
          [...graphPosts.values()].filter((post) => post.id.startsWith(`${pageId}_`)),
        ),
};

/** The one short link the redirect hop knows. */
const SHORT = 'https://www.facebook.com/share/p/1Short/';
const shortTarget = { location: '' };
const fakeFetch = ((target: URL) =>
  Promise.resolve(
    target.toString() === SHORT
      ? new Response(null, { status: 302, headers: { location: shortTarget.location } })
      : new Response('not found', { status: 404 }),
  )) as unknown as typeof fetch;

/** Stands in for the Page module: its repository, and Graph without a network. */
@Module({
  providers: [FacebookPageRepository, { provide: META_GRAPH, useValue: fakeGraph }],
  exports: [FacebookPageRepository, META_GRAPH],
})
class FakePageModule {}

const postNumber = () => String(Math.floor(Math.random() * 1e14));

describeDb('Product posts over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();

  const server = () => app.getHttpServer();
  const postsOf = (productId: string) => `/api/v1/products/${productId}/posts`;

  /** Signs up, follows the verification link, and reads the shop id. */
  const verifiedSellerWithShop = async () => {
    const address = `seller-${randomUUID()}@${EMAIL_DOMAIN}`;
    await request(server())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', APP_URL)
      .send({
        email: address,
        password: PASSWORD,
        name: 'Nadia Rahman',
        shopName: "Nadia's Sarees",
        phone: '+880 1712-345678',
        callbackURL: '/',
      })
      .expect(200);
    const agent = request.agent(server());
    await agent.get(mailer.linkTo(address)).expect(302);
    const session = await agent.get('/api/v1/auth/get-session').expect(200);
    return { agent, merchantId: session.body.session.activeOrganizationId as string };
  };

  const activeProduct = (merchantId: string, name = 'Jamdani Saree') =>
    seedProduct(db, merchantId, { name, status: 'active' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema });

    const env: Record<string, string> = {
      NODE_ENV: 'test',
      APP_URL,
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      TOKEN_ENCRYPTION_KEY: KEY,
    };

    @Global()
    @Module({
      providers: [
        { provide: DATABASE, useValue: db },
        { provide: AppConfig, useValue: { get: (key: string) => env[key] } },
      ],
      exports: [DATABASE, AppConfig],
    })
    class TestInfrastructureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestInfrastructureModule, AuthModule, ProductPostsModule],
      providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
    })
      .overrideModule(FacebookPageModule)
      .useModule(FakePageModule)
      .overrideProvider(POST_LINK_FETCH)
      .useValue(fakeFetch)
      .overrideProvider(MailService)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication({
      ...NEST_APP_OPTIONS,
      bufferLogs: false,
      logger: false,
    });
    configureApp(app, silentLogger);
    await listenOnLoopback(app);
  });

  beforeEach(() => {
    graphRefuses = false;
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(like(schema.user.email, `%@${EMAIL_DOMAIN}`))
    ).map((row) => row.id);
    if (userIds.length > 0) {
      const orgIds = (
        await db
          .select({ id: schema.member.organizationId })
          .from(schema.member)
          .where(inArray(schema.member.userId, userIds))
      ).map((row) => row.id);
      if (orgIds.length > 0) {
        await db.delete(schema.productPost).where(inArray(schema.productPost.merchantId, orgIds));
        await db.delete(schema.product).where(inArray(schema.product.merchantId, orgIds));
        await db.delete(schema.facebookPage).where(inArray(schema.facebookPage.merchantId, orgIds));
        await db
          .delete(schema.merchantSettings)
          .where(inArray(schema.merchantSettings.merchantId, orgIds));
      }
      await db.delete(schema.user).where(inArray(schema.user.id, userIds));
      if (orgIds.length > 0) {
        await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds));
      }
    }
    await pool.end();
  });

  it('answers 401 without a session', async () => {
    await request(server()).get(postsOf(randomUUID())).expect(401);
    await request(server()).get('/api/v1/messenger/page-posts').expect(401);
  });

  it('links a pasted post, lists it, and refuses it for a second product', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const saree = await activeProduct(merchantId);
    const kurti = await activeProduct(merchantId, 'Blue Kurti');
    const id = postNumber();
    const link = `https://www.facebook.com/nadias/posts/${id}`;

    const created = await agent.post(postsOf(saree.id)).send({ url: link }).expect(201);
    expect(created.body).toMatchObject({ postId: id, url: link, status: 'linked', caption: null });

    const listed = await agent.get(postsOf(saree.id)).expect(200);
    expect(productPostListResponseSchema.parse(listed.body).data).toEqual([created.body]);

    // Linking it again to the same product changes nothing.
    await agent.post(postsOf(saree.id)).send({ url: link }).expect(201);

    const taken = await agent.post(postsOf(kurti.id)).send({ url: link }).expect(409);
    expect(taken.body.error).toMatchObject({
      code: 'PRODUCT_POST_TAKEN',
      params: { productId: saree.id, productName: 'Jamdani Saree' },
    });
  });

  it.each([
    ['another host', 'https://example.com/nadias/posts/1'],
    ['javascript:', 'javascript:alert(1)'],
    ['an IP address', 'http://127.0.0.1/nadias/posts/1'],
    ['a profile', 'https://www.facebook.com/nadias'],
  ])('refuses %s as PRODUCT_POST_INVALID_URL', async (_name, link) => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const saree = await activeProduct(merchantId);
    const response = await agent.post(postsOf(saree.id)).send({ url: link }).expect(400);
    expect(response.body.error.code).toBe('PRODUCT_POST_INVALID_URL');
  });

  it('follows a short share link one hop', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const saree = await activeProduct(merchantId);
    const id = postNumber();
    shortTarget.location = `https://www.facebook.com/nadias/posts/${id}`;

    const created = await agent.post(postsOf(saree.id)).send({ url: SHORT }).expect(201);

    expect(created.body).toMatchObject({ postId: id, status: 'linked' });
  });

  it('reads the caption of a pasted post on the connected Page', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const page = await seedFacebookPage(db, merchantId, { accessToken: crypto.encrypt('token') });
    const saree = await activeProduct(merchantId);
    const id = postNumber();
    graphPosts.set(`${page.pageId}_${id}`, {
      id: `${page.pageId}_${id}`,
      message: 'New Jamdani in stock',
      permalinkUrl: `https://www.facebook.com/nadias/posts/pfbid0${id}abcdefghijk`,
      pictureUrl: null,
      createdTime: '2026-10-14T10:00:00+0000',
    });

    const created = await agent
      .post(postsOf(saree.id))
      .send({ url: `https://www.facebook.com/nadias/posts/${id}` })
      .expect(201);

    expect(created.body).toMatchObject({ postId: id, caption: 'New Jamdani in stock' });
    const [row] = await db
      .select()
      .from(schema.productPost)
      .where(inArray(schema.productPost.id, [created.body.id]));
    expect(row?.aliasId).toBe(`pfbid0${id}abcdefghijk`);
  });

  it("lists the Page's posts with their products, and links one picked from the list", async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const saree = await activeProduct(merchantId);

    const missing = await agent.get('/api/v1/messenger/page-posts').expect(409);
    expect(missing.body.error.code).toBe('MESSENGER_PAGE_NOT_CONNECTED');

    const page = await seedFacebookPage(db, merchantId, { accessToken: crypto.encrypt('token') });
    const id = postNumber();
    graphPosts.set(`${page.pageId}_${id}`, {
      id: `${page.pageId}_${id}`,
      message: 'Eid collection',
      permalinkUrl: `https://www.facebook.com/nadias/posts/${id}`,
      pictureUrl: 'https://scontent.example/p.jpg',
      createdTime: '2026-10-14T10:00:00+0000',
    });

    const before = await agent.get('/api/v1/messenger/page-posts').expect(200);
    expect(pagePostListResponseSchema.parse(before.body).data).toEqual([
      {
        id: `${page.pageId}_${id}`,
        message: 'Eid collection',
        url: `https://www.facebook.com/nadias/posts/${id}`,
        pictureUrl: 'https://scontent.example/p.jpg',
        createdAt: '2026-10-14T10:00:00.000Z',
        linkedProduct: null,
      },
    ]);

    await agent
      .post(postsOf(saree.id))
      .send({ pagePostId: `${page.pageId}_${id}` })
      .expect(201);
    const after = await agent.get('/api/v1/messenger/page-posts').expect(200);
    expect(after.body.data[0].linkedProduct).toEqual({ id: saree.id, name: 'Jamdani Saree' });

    // Another Page's post id is not this shop's to link.
    const foreign = await agent
      .post(postsOf(saree.id))
      .send({ pagePostId: `1${page.pageId}_${id}` })
      .expect(400);
    expect(foreign.body.error.code).toBe('PRODUCT_POST_INVALID_URL');

    graphRefuses = true;
    const refused = await agent.get('/api/v1/messenger/page-posts').expect(409);
    expect(refused.body.error).toMatchObject({
      code: 'FACEBOOK_PERMISSION_MISSING',
      params: { permission: 'pages_read_engagement' },
    });
  });

  it('accepts a suggestion, then removes it', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const saree = await activeProduct(merchantId);
    const [suggested] = await db
      .insert(schema.productPost)
      .values({ merchantId, productId: saree.id, postId: postNumber(), status: 'suggested' })
      .returning();

    const accepted = await agent
      .patch(`${postsOf(saree.id)}/${suggested!.id}`)
      .send({ status: 'linked' })
      .expect(200);
    expect(accepted.body).toMatchObject({ id: suggested!.id, status: 'linked' });

    await agent
      .patch(`${postsOf(saree.id)}/${suggested!.id}`)
      .send({ status: 'suggested' })
      .expect(400);

    await agent.delete(`${postsOf(saree.id)}/${suggested!.id}`).expect(204);
    const gone = await agent.delete(`${postsOf(saree.id)}/${suggested!.id}`).expect(404);
    expect(gone.body.error.code).toBe('PRODUCT_POST_NOT_FOUND');
  });

  it('refuses an archived product', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const archived = await seedProduct(db, merchantId, { status: 'archived' });
    const response = await agent
      .post(postsOf(archived.id))
      .send({ url: `https://www.facebook.com/nadias/posts/${postNumber()}` })
      .expect(409);
    expect(response.body.error).toMatchObject({
      code: 'PRODUCT_POST_ARCHIVED',
      params: { productId: archived.id },
    });
  });

  it("never lists, links, accepts or removes another shop's posts", async () => {
    const a = await verifiedSellerWithShop();
    const b = await verifiedSellerWithShop();
    const theirs = await activeProduct(b.merchantId);
    const [row] = await db
      .insert(schema.productPost)
      .values({
        merchantId: b.merchantId,
        productId: theirs.id,
        postId: postNumber(),
        status: 'suggested',
      })
      .returning();

    const listed = await a.agent.get(postsOf(theirs.id)).expect(404);
    expect(listed.body.error.code).toBe('PRODUCT_NOT_FOUND');
    const linked = await a.agent
      .post(postsOf(theirs.id))
      .send({ url: `https://www.facebook.com/x/posts/${postNumber()}` })
      .expect(404);
    expect(linked.body.error.code).toBe('PRODUCT_NOT_FOUND');
    await a.agent
      .patch(`${postsOf(theirs.id)}/${row!.id}`)
      .send({ status: 'linked' })
      .expect(404);
    await a.agent.delete(`${postsOf(theirs.id)}/${row!.id}`).expect(404);

    const [still] = await db
      .select()
      .from(schema.productPost)
      .where(inArray(schema.productPost.id, [row!.id]));
    expect(still).toMatchObject({ status: 'suggested', merchantId: b.merchantId });
  });

  it('answers 400 for a body that is neither a link nor a picked post', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const saree = await activeProduct(merchantId);
    const response = await agent.post(postsOf(saree.id)).send({ postId: '1' }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    await agent.get('/api/v1/products/not-a-uuid/posts').expect(400);
  });
});
