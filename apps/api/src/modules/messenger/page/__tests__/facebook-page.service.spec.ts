import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../../common/crypto.service';
import type { AppConfig } from '../../../config/app.config';
import type { Database } from '../../../database/database.module';
import * as schema from '../../../database/schema/index';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import { FacebookPageRepository } from '../facebook-page.repository';
import { FacebookPageService, type PageConnectOwner } from '../facebook-page.service';
import {
  GraphError,
  PAGE_CONNECT_SCOPES,
  type GraphPage,
  type MetaGraphClient,
} from '../meta-graph.client';
import { openFlow, sealFlow } from '../page-connect-flow';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);

const REDIRECT_URI = 'https://shop.test/api/v1/messenger/page/oauth/callback';

/** Facebook as the service sees it: the seller's Pages and what our app did to them. */
class FakeGraph {
  pages = new Map<string, GraphPage & { accessToken: string }>();
  granted = new Set<string>(PAGE_CONNECT_SCOPES);
  subscribed = new Set<string>();
  unsubscribed: { pageId: string; token: string }[] = [];
  failWith: GraphError | null = null;

  addPage(id: string, name: string, tasks = ['MANAGE', 'MESSAGING']) {
    this.pages.set(id, { id, name, tasks, accessToken: `page-token-${id}` });
  }

  authorizeUrl(state: string, redirectUri: string) {
    return `https://www.facebook.com/dialog/oauth?state=${state}&redirect_uri=${redirectUri}`;
  }
  async exchangeCode(code: string, redirectUri: string) {
    this.fail();
    if (code !== 'good-code' || redirectUri !== REDIRECT_URI) {
      throw new GraphError(400, 100, 'bad code');
    }
    return 'long-user-token';
  }
  async grantedPermissions() {
    this.fail();
    return this.granted;
  }
  async listPages(token: string) {
    this.fail();
    expect(token).toBe('long-user-token');
    return [...this.pages.values()].map(({ id, name, tasks }) => ({ id, name, tasks }));
  }
  async getPage(_token: string, pageId: string) {
    this.fail();
    return this.pages.get(pageId) ?? null;
  }
  async subscribeApp(pageId: string, token: string) {
    this.fail();
    expect(token).toBe(`page-token-${pageId}`);
    this.subscribed.add(pageId);
  }
  async unsubscribeApp(pageId: string, token: string) {
    this.fail();
    this.unsubscribed.push({ pageId, token });
  }

  private fail() {
    if (this.failWith) throw this.failWith;
  }
}

describeDb('FacebookPageService', () => {
  let t: CatalogTestDb;
  let runtime: { db: Database; close(): Promise<void> };
  let graph: FakeGraph;
  let service: FacebookPageService;
  const ownerA = (): PageConnectOwner => ({ merchantId: t.merchantA, userId: 'user-a' });
  const ownerB = (): PageConnectOwner => ({ merchantId: t.merchantB, userId: 'user-b' });

  /** The cookie the callback would have set for this owner. */
  const authorized = (owner: PageConnectOwner) =>
    sealFlow(crypto, {
      stage: 'authorized',
      userToken: 'long-user-token',
      ...owner,
      expiresAt: Date.now() + 60_000,
    });

  const rows = () =>
    t.db
      .select()
      .from(schema.facebookPage)
      .where(eq(schema.facebookPage.pageId, '1001'))
      .then((r) => r.concat());

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });

  beforeEach(async () => {
    await t.db.delete(schema.facebookPage).where(eq(schema.facebookPage.merchantId, t.merchantA));
    await t.db.delete(schema.facebookPage).where(eq(schema.facebookPage.merchantId, t.merchantB));
    graph = new FakeGraph();
    graph.addPage('1001', 'Rahim Kitchen');
    graph.addPage('1002', 'Rahim Sweets');
    // As app_runtime, so row-level security applies exactly as in production.
    service = new FacebookPageService(
      runtime.db,
      new FacebookPageRepository(),
      crypto,
      graph as unknown as MetaGraphClient,
      REDIRECT_URI,
    );
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  describe('the OAuth round trip', () => {
    it('starts with a state the callback must echo, and ends authorized', async () => {
      const { url, cookie } = service.start(ownerA());
      const state = new URL(url).searchParams.get('state') ?? '';
      expect(state).not.toBe('');

      const next = await service.completeAuthorization(ownerA(), cookie, {
        code: 'good-code',
        state,
      });
      expect(openFlow(crypto, next, ownerA())).toMatchObject({
        stage: 'authorized',
        userToken: 'long-user-token',
      });
    });

    it('refuses a callback whose state does not match', async () => {
      const { cookie } = service.start(ownerA());
      await expectCoded(
        service.completeAuthorization(ownerA(), cookie, { code: 'good-code', state: 'forged' }),
        'FACEBOOK_AUTH_FAILED',
      );
    });

    it("refuses a callback without the flow cookie, or with another seller's", async () => {
      const { url, cookie } = service.start(ownerA());
      const state = new URL(url).searchParams.get('state') ?? '';
      await expectCoded(
        service.completeAuthorization(ownerA(), undefined, { code: 'good-code', state }),
        'FACEBOOK_AUTH_EXPIRED',
      );
      await expectCoded(
        service.completeAuthorization(ownerB(), cookie, { code: 'good-code', state }),
        'FACEBOOK_AUTH_EXPIRED',
      );
    });

    it('reports a seller who cancelled on Facebook', async () => {
      const { url, cookie } = service.start(ownerA());
      const state = new URL(url).searchParams.get('state') ?? '';
      await expectCoded(
        service.completeAuthorization(ownerA(), cookie, { state, error: 'access_denied' }),
        'FACEBOOK_AUTH_CANCELLED',
      );
    });

    it('refuses when a Page permission was unticked', async () => {
      graph.granted.delete('pages_messaging');
      const { url, cookie } = service.start(ownerA());
      const state = new URL(url).searchParams.get('state') ?? '';
      await expectCoded(
        service.completeAuthorization(ownerA(), cookie, { code: 'good-code', state }),
        'FACEBOOK_PERMISSIONS_DECLINED',
      );
    });

    it('maps a rejected code and an unreachable Facebook to their own codes', async () => {
      const { url, cookie } = service.start(ownerA());
      const state = new URL(url).searchParams.get('state') ?? '';
      await expectCoded(
        service.completeAuthorization(ownerA(), cookie, { code: 'bad-code', state }),
        'FACEBOOK_AUTH_FAILED',
      );
      graph.failWith = new GraphError(503, undefined, 'down');
      await expectCoded(
        service.completeAuthorization(ownerA(), cookie, { code: 'good-code', state }),
        'FACEBOOK_UNAVAILABLE',
      );
    });
  });

  describe('listCandidates', () => {
    it("lists the seller's Pages, flagging those without messaging access", async () => {
      graph.addPage('1003', 'Analyst only', ['ANALYZE']);
      await expect(service.listCandidates(ownerA(), authorized(ownerA()))).resolves.toEqual([
        { pageId: '1003', name: 'Analyst only', canMessage: false },
        { pageId: '1001', name: 'Rahim Kitchen', canMessage: true },
        { pageId: '1002', name: 'Rahim Sweets', canMessage: true },
      ]);
    });

    it('needs an authorized flow', async () => {
      await expectCoded(service.listCandidates(ownerA(), undefined), 'FACEBOOK_AUTH_EXPIRED');
      const { cookie } = service.start(ownerA());
      await expectCoded(service.listCandidates(ownerA(), cookie), 'FACEBOOK_AUTH_EXPIRED');
    });

    it('asks to start again when Facebook revoked the user token', async () => {
      graph.failWith = new GraphError(401, 190, 'expired');
      await expectCoded(
        service.listCandidates(ownerA(), authorized(ownerA())),
        'FACEBOOK_AUTH_EXPIRED',
      );
    });
  });

  describe('connect', () => {
    it('stores the Page with its token encrypted and subscribes our app', async () => {
      const page = await service.connect(ownerA(), authorized(ownerA()), '1001');

      expect(page).toMatchObject({ pageId: '1001', name: 'Rahim Kitchen', botEnabled: true });
      expect(graph.subscribed.has('1001')).toBe(true);
      const [row] = await rows();
      expect(row?.merchantId).toBe(t.merchantA);
      expect(row?.accessToken).not.toContain('page-token');
      expect(crypto.decrypt(row?.accessToken ?? '')).toBe('page-token-1001');
      await expect(service.get(ownerA())).resolves.toEqual(page);
    });

    it('refreshes the name and token on a reconnect of the same Page', async () => {
      const first = await service.connect(ownerA(), authorized(ownerA()), '1001');
      graph.addPage('1001', 'Rahim Kitchen BD');
      const again = await service.connect(ownerA(), authorized(ownerA()), '1001');

      expect(again).toMatchObject({ id: first.id, name: 'Rahim Kitchen BD' });
      expect(await rows()).toHaveLength(1);
    });

    it('refuses a second, different Page for the same shop', async () => {
      await service.connect(ownerA(), authorized(ownerA()), '1001');
      await expectCoded(
        service.connect(ownerA(), authorized(ownerA()), '1002'),
        'FACEBOOK_PAGE_ALREADY_CONNECTED',
      );
      expect(graph.subscribed.has('1002')).toBe(false);
    });

    it('refuses a Page the seller did not grant, or cannot message from', async () => {
      await expectCoded(
        service.connect(ownerA(), authorized(ownerA()), '9999'),
        'FACEBOOK_PAGE_NOT_FOUND',
      );
      graph.addPage('1003', 'Analyst only', ['ANALYZE']);
      await expectCoded(
        service.connect(ownerA(), authorized(ownerA()), '1003'),
        'FACEBOOK_PAGE_NO_MESSAGING_ACCESS',
      );
    });

    it('needs an authorized flow', async () => {
      await expectCoded(service.connect(ownerA(), undefined, '1001'), 'FACEBOOK_AUTH_EXPIRED');
    });
  });

  describe('two merchants', () => {
    it("never shows one shop another's Page", async () => {
      await service.connect(ownerA(), authorized(ownerA()), '1001');
      await expect(service.get(ownerB())).resolves.toBeNull();
    });

    it('refuses to connect a Page another shop already has, and leaves it theirs', async () => {
      await service.connect(ownerA(), authorized(ownerA()), '1001');
      await expectCoded(
        service.connect(ownerB(), authorized(ownerB()), '1001'),
        'FACEBOOK_PAGE_TAKEN',
      );
      const [row] = await rows();
      expect(row?.merchantId).toBe(t.merchantA);
    });

    it("cannot disconnect another shop's Page", async () => {
      await service.connect(ownerA(), authorized(ownerA()), '1001');
      await service.disconnect(ownerB());
      expect(await rows()).toHaveLength(1);
      expect(graph.unsubscribed).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('forgets the Page and unsubscribes with its decrypted token', async () => {
      await service.connect(ownerA(), authorized(ownerA()), '1001');
      await service.disconnect(ownerA());

      await expect(service.get(ownerA())).resolves.toBeNull();
      expect(graph.unsubscribed).toEqual([{ pageId: '1001', token: 'page-token-1001' }]);
    });

    it('still forgets the Page when Facebook cannot be reached', async () => {
      await service.connect(ownerA(), authorized(ownerA()), '1001');
      graph.failWith = new GraphError(503, undefined, 'down');
      await service.disconnect(ownerA());
      await expect(service.get(ownerA())).resolves.toBeNull();
    });

    it('is a no-op without a Page', async () => {
      await expect(service.disconnect(ownerA())).resolves.toBeUndefined();
    });
  });

  it('answers MESSENGER_NOT_CONFIGURED without Facebook app credentials', async () => {
    const unconfigured = new FacebookPageService(
      runtime.db,
      new FacebookPageRepository(),
      crypto,
      null,
      REDIRECT_URI,
    );
    expect(() => unconfigured.start(ownerA())).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'MESSENGER_NOT_CONFIGURED' }),
      }),
    );
  });
});
