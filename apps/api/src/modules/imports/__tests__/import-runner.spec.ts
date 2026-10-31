import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { PostProducts, PostProduct } from '@app/shared';
import { CryptoService } from '../../../common/crypto.service';
import { CategoriesRepository } from '../../categories/categories.repository';
import type { AppConfig } from '../../config/app.config';
import { LlmCallRepository } from '../../conversations/assistant/llm-call.repository';
import type { DownloadResult } from '../../conversations/photos/photo-download';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  seedCategory,
  seedProduct,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedFacebookPage } from '../../database/__tests__/conversation-seeds';
import * as schema from '../../database/schema/index';
import type { LlmClient, LlmFailure, LlmResult, PostExtractionRequest } from '../../llm/llm.types';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import {
  GraphError,
  type GraphImportPost,
  type GraphPostPage,
  type MetaGraphClient,
} from '../../messenger/page/meta-graph.client';
import { ProductPostRepository } from '../../messenger/posts/product-post.repository';
import type { NotificationsService } from '../../notifications/notifications.service';
import { ProductImageRepository } from '../../products/images/product-image.repository';
import { ProductOptionsRepository } from '../../products/options/product-options.repository';
import { ProductWriter } from '../../products/options/product-writer';
import { ProductsRepository } from '../../products/products.repository';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { ImportPhotos } from '../import-photos';
import { GraphUnavailable, ImportRunner, LLM_FAILURES_TO_FAIL } from '../import-runner';
import { ImportRepository } from '../import.repository';

const KEY = Buffer.alloc(32, 7).toString('base64');
const crypto = new CryptoService({ get: () => KEY } as unknown as AppConfig);

/** The connected Page's posts as Graph pages them, by `after` cursor. */
class FakeGraph {
  pages = new Map<string | null, GraphPostPage>();
  byId = new Map<string, GraphImportPost>();
  refuse: GraphError | null = null;
  calls: (string | null)[] = [];

  async listPublishedPosts(
    _token: string,
    _pageId: string,
    range: { after?: string | null; limit?: number },
  ): Promise<GraphPostPage> {
    if (this.refuse) throw this.refuse;
    if (range.limit === 1) return { posts: [], after: null };
    this.calls.push(range.after ?? null);
    return this.pages.get(range.after ?? null) ?? { posts: [], after: null };
  }

  async getImportPost(_token: string, id: string): Promise<GraphImportPost | null> {
    if (this.refuse) throw this.refuse;
    return this.byId.get(id) ?? null;
  }

  /** One page per argument, chained by cursors c1, c2, … */
  setPages(...pages: GraphImportPost[][]): void {
    this.pages.clear();
    pages.forEach((posts, index) => {
      this.pages.set(index === 0 ? null : `c${index}`, {
        posts,
        after: index < pages.length - 1 ? `c${index + 1}` : null,
      });
      for (const post of posts) this.byId.set(post.id, post);
    });
  }
}

/** Reads a post by its caption: `answers` maps a caption to what the LLM says. */
class FakeLlm implements Pick<LlmClient, 'extractProductsFromPost'> {
  answers = new Map<string, PostProducts | LlmFailure>();
  requests: PostExtractionRequest[] = [];
  /** Runs during a call, before it answers: a seller's click mid-post. */
  during: (() => Promise<void>) | null = null;

  async extractProductsFromPost(request: PostExtractionRequest): Promise<LlmResult<PostProducts>> {
    this.requests.push(request);
    if (this.during) await this.during();
    const usage = {
      purpose: 'post_import' as const,
      model: 'gpt-test',
      inputTokens: 4000,
      outputTokens: 300,
      latencyMs: 900,
      promptPack: 'bn-BD',
    };
    const answer = this.answers.get(request.caption ?? '') ?? {
      kind: 'not_product' as const,
      reason: 'Not set up in the test',
      products: [],
    };
    return typeof answer === 'string'
      ? { ok: false, reason: answer, usage }
      : { ok: true, value: answer, usage };
  }
}

const item = (name: string, overrides: Partial<PostProduct> = {}): PostProduct => ({
  name,
  description: null,
  aliases: [],
  options: [],
  prices: [{ values: [], price: 1200 }],
  category: null,
  ...overrides,
});
/** `count` distinct size values: one more than an option may hold is cut. */
const sizes = (count: number) => Array.from({ length: count }, (_, index) => String(30 + index));

const sells = (...items: PostProduct[]): PostProducts => ({
  kind: 'products',
  reason: null,
  products: items,
});

describeDb('ImportRunner (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let jpeg: Buffer;
  let graph: FakeGraph;
  let llm: FakeLlm;
  let storage: InMemoryObjectStorage;
  let ended: { importId: string; endedAt: Date }[];
  let downloads: string[];
  let runner: ImportRunner;
  let pageId: string;
  let postSeq = 0;

  const repo = new ImportRepository();

  const post = (caption: string | null, photos = 1): GraphImportPost => {
    postSeq += 1;
    return {
      id: `${pageId}_${1000 + postSeq}`,
      message: caption,
      permalinkUrl: null,
      createdTime: '2026-08-01T10:00:00+0000',
      photoUrls: Array.from(
        { length: photos },
        (_, index) => `https://scontent.xx.fbcdn.net/p${postSeq}-${index}.jpg`,
      ),
    };
  };

  const startRun = async (status: 'queued' | 'stopping' = 'queued') => {
    const [run] = await t.db
      .insert(schema.productImport)
      .values({
        merchantId: t.merchantA,
        source: 'facebook_posts',
        since: '2026-07-01',
        until: '2026-09-30',
        status,
      })
      .returning();
    return run!;
  };

  const runOf = async (id: string) =>
    (await t.db.select().from(schema.productImport).where(eq(schema.productImport.id, id)))[0]!;
  const postsOf = (importId: string) =>
    t.db
      .select()
      .from(schema.productImportPost)
      .where(eq(schema.productImportPost.importId, importId));
  const postRow = async (importId: string, postId: string) =>
    (await postsOf(importId)).find((row) => row.postId === postId)!;
  const productOf = async (id: string) =>
    (await t.db.select().from(schema.product).where(eq(schema.product.id, id)))[0];

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#c00' } })
      .jpeg()
      .toBuffer();
    const page = await seedFacebookPage(t.db, t.merchantA, {
      accessToken: crypto.encrypt('page-token'),
    });
    pageId = page.pageId;
  });

  beforeEach(async () => {
    graph = new FakeGraph();
    llm = new FakeLlm();
    storage = new InMemoryObjectStorage();
    ended = [];
    downloads = [];
    const download = async (url: string | null): Promise<DownloadResult> => {
      downloads.push(url ?? '');
      return url?.includes('broken') ? { ok: false, reason: 'failed' } : { ok: true, body: jpeg };
    };
    const products = new ProductsRepository();
    const options = new ProductOptionsRepository();
    runner = new ImportRunner(
      runtime.db,
      repo,
      products,
      options,
      new ProductWriter(products, options),
      new ProductImageRepository(),
      new CategoriesRepository(),
      new ProductPostRepository(),
      new FacebookPageRepository(),
      new MerchantSettingsRepository(),
      new LlmCallRepository(),
      new ImportPhotos(storage, download),
      {
        importFinished: async (_merchantId: string, importId: string, endedAt: Date) => {
          ended.push({ importId, endedAt });
        },
      } as unknown as NotificationsService,
      crypto,
      graph as unknown as MetaGraphClient,
      llm as unknown as LlmClient,
    );
  });

  afterEach(async () => {
    // Runs first (posts and llm calls cascade), then the drafts they made.
    await t.db.delete(schema.productImport).where(eq(schema.productImport.merchantId, t.merchantA));
    await t.db
      .delete(schema.productCategory)
      .where(eq(schema.productCategory.merchantId, t.merchantA));
    await t.db
      .delete(schema.productVariant)
      .where(eq(schema.productVariant.merchantId, t.merchantA));
    await t.db.delete(schema.product).where(eq(schema.product.merchantId, t.merchantA));
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('reads every page, keeps the cursor, and finishes with the counts and one email', async () => {
    const first = [post('Katan saree'), post('Eid Mubarak')];
    const second = [post('Lungi')];
    graph.setPages(first, second);
    llm.answers.set('Katan saree', sells(item('Katan saree')));
    llm.answers.set('Lungi', sells(item('Lungi')));
    llm.answers.set('Eid Mubarak', { kind: 'not_product', reason: 'Eid greeting', products: [] });
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(graph.calls).toEqual([null, 'c1']);
    const after = await runOf(run.id);
    expect(after).toMatchObject({
      status: 'finished',
      cursor: 'c1',
      postsTotal: 3,
      postsRead: 3,
      drafts: 2,
      notProducts: 1,
      failed: 0,
      errorCode: null,
    });
    expect(after.startedAt).not.toBeNull();
    expect(ended).toEqual([{ importId: run.id, endedAt: after.finishedAt }]);
    expect(await postRow(run.id, first[1]!.id)).toMatchObject({
      result: 'not_a_product',
      note: 'Eid greeting',
    });
  });

  it('flags a post whose products were cut to the catalog limits', async () => {
    const tidy = post('Kurti');
    const crowded = post('Shoes');
    graph.setPages([tidy, crowded]);
    llm.answers.set('Kurti', sells(item('Kurti')));
    llm.answers.set(
      'Shoes',
      sells(item('Sandal', { options: [{ name: 'Size', values: sizes(31) }] })),
    );
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(await postRow(run.id, tidy.id)).toMatchObject({ result: 'draft', limitsApplied: false });
    expect(await postRow(run.id, crowded.id)).toMatchObject({
      result: 'draft',
      limitsApplied: true,
    });
  });

  it('writes a draft with its photos, cover, category, aliases, link and LLM call', async () => {
    const category = await seedCategory(t.db, t.merchantA, { name: 'Sarees' });
    const one = post('জামদানি শাড়ি ১২০০ টাকা', 2);
    graph.setPages([one]);
    llm.answers.set(
      one.message!,
      sells(
        item('জামদানি শাড়ি', {
          aliases: ['jamdani saree'],
          options: [{ name: 'রং', values: ['লাল', 'নীল'] }],
          category: { kind: 'existing', name: 'Sarees' },
        }),
      ),
    );
    const run = await startRun();
    await runner.run(t.merchantA, run.id);

    const row = await postRow(run.id, one.id);
    expect(row).toMatchObject({ result: 'draft', photoCount: 2 });
    const draft = (await productOf(row.productIds[0]!))!;
    expect(draft).toMatchObject({
      status: 'draft',
      name: 'জামদানি শাড়ি',
      aliases: ['jamdani saree'],
    });
    const variants = await t.db
      .select()
      .from(schema.productVariant)
      .where(eq(schema.productVariant.productId, draft.id));
    expect(variants.map((variant) => [variant.name, variant.price, variant.stock])).toEqual(
      expect.arrayContaining([
        ['লাল', 120_000, null],
        ['নীল', 120_000, null],
      ]),
    );
    const images = await t.db
      .select()
      .from(schema.productImage)
      .where(eq(schema.productImage.productId, draft.id));
    expect(images).toHaveLength(2);
    expect(draft.coverImageId).toBe(images.find((image) => image.position === 0)!.id);
    for (const image of images) expect(storage.objects.has(image.storageKey)).toBe(true);
    expect(
      await t.db
        .select()
        .from(schema.productCategory)
        .where(eq(schema.productCategory.productId, draft.id)),
    ).toEqual([expect.objectContaining({ categoryId: category.id })]);
    const links = await t.db
      .select()
      .from(schema.productPost)
      .where(eq(schema.productPost.productId, draft.id));
    expect(links).toEqual([
      expect.objectContaining({ postId: one.id.split('_')[1], status: 'linked' }),
    ]);
    const calls = await t.db
      .select()
      .from(schema.llmCall)
      .where(eq(schema.llmCall.importId, run.id));
    expect(calls).toEqual([
      expect.objectContaining({ purpose: 'post_import', conversationId: null, outcome: 'ok' }),
    ]);
    expect(llm.requests[0]!.photos).toHaveLength(2);
    expect(llm.requests[0]!.categories).toContain('Sarees');
  });

  it('skips a post a product already links, with no LLM call', async () => {
    const product = await seedProduct(t.db, t.merchantA, { status: 'active' });
    const linked = post('Panjabi');
    await t.db.insert(schema.productPost).values({
      merchantId: t.merchantA,
      productId: product.id,
      postId: linked.id.split('_')[1]!,
      status: 'linked',
    });
    graph.setPages([linked]);
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(llm.requests).toEqual([]);
    expect(downloads).toEqual([]);
    expect(await postRow(run.id, linked.id)).toMatchObject({
      result: 'already_imported',
      matchedProductIds: [product.id],
    });
    expect(await runOf(run.id)).toMatchObject({ alreadyImported: 1, postsRead: 1 });
  });

  it("skips an earlier run's not-product and in-catalog posts, and reads its failed one again", async () => {
    const [notProduct, inCatalog, failed] = [post('Hello'), post('Old'), post('Retry me')];
    const earlier = await startRun();
    await t.db
      .update(schema.productImport)
      .set({ status: 'finished' })
      .where(eq(schema.productImport.id, earlier.id));
    await t.db.insert(schema.productImportPost).values(
      [
        [notProduct, 'not_a_product'],
        [inCatalog, 'in_catalog'],
        [failed, 'llm_failed'],
      ].map(([graphPost, result]) => ({
        merchantId: t.merchantA,
        importId: earlier.id,
        postId: (graphPost as GraphImportPost).id,
        result: result as 'llm_failed',
      })),
    );
    graph.setPages([notProduct, inCatalog, failed]);
    llm.answers.set('Retry me', sells(item('Retry me')));
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(llm.requests.map((request) => request.caption)).toEqual(['Retry me']);
    expect(await runOf(run.id)).toMatchObject({ alreadyImported: 2, drafts: 1 });
  });

  it('reads a post with no caption and no photo as not a product, with no LLM call', async () => {
    const empty = post(null, 0);
    graph.setPages([empty]);
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(llm.requests).toEqual([]);
    expect(await postRow(run.id, empty.id)).toMatchObject({
      result: 'no_caption_or_photo',
      note: null,
    });
  });

  it('skips a post whose products are all in the catalog, whatever their status, and leaves them alone', async () => {
    const active = await seedProduct(t.db, t.merchantA, { name: 'Katan saree', status: 'active' });
    const draft = await seedProduct(t.db, t.merchantA, { name: 'Muslin', status: 'draft' });
    const archived = await seedProduct(t.db, t.merchantA, { name: 'Lungi', status: 'archived' });
    const posts = [post('a'), post('b'), post('c')];
    graph.setPages(posts);
    llm.answers.set('a', sells(item('Katan Saree')));
    llm.answers.set('b', sells(item('Muslin')));
    llm.answers.set('c', sells(item('lungi')));
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(await runOf(run.id)).toMatchObject({ inCatalog: 3, drafts: 0 });
    for (const [graphPost, known] of [
      [posts[0]!, active],
      [posts[1]!, draft],
      [posts[2]!, archived],
    ] as const) {
      expect(await postRow(run.id, graphPost.id)).toMatchObject({
        result: 'in_catalog',
        matchedProductIds: [known.id],
        productIds: [],
      });
      expect(await productOf(known.id)).toMatchObject({
        status: known.status,
        revision: known.revision,
      });
    }
  });

  it('makes a draft of the new product in a post that also holds a known one', async () => {
    const known = await seedProduct(t.db, t.merchantA, { name: 'Katan saree', status: 'active' });
    const both = post('both');
    graph.setPages([both]);
    llm.answers.set('both', sells(item('Katan saree'), item('Muslin three piece')));
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    const row = await postRow(run.id, both.id);
    expect(row).toMatchObject({ result: 'draft', matchedProductIds: [known.id] });
    expect(row.productIds).toHaveLength(1);
    expect((await productOf(row.productIds[0]!))!.name).toBe('Muslin three piece');
  });

  it('links no post to a product when the post gave two', async () => {
    const two = post('two', 2);
    graph.setPages([two]);
    llm.answers.set('two', sells(item('Muslin'), item('Silk')));
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    const row = await postRow(run.id, two.id);
    expect(row.productIds).toHaveLength(2);
    expect(
      await t.db
        .select()
        .from(schema.productPost)
        .where(eq(schema.productPost.merchantId, t.merchantA)),
    ).toEqual([]);
    // Each draft has its own copy of the photos.
    const images = await t.db
      .select()
      .from(schema.productImage)
      .where(eq(schema.productImage.merchantId, t.merchantA));
    expect(images).toHaveLength(4);
  });

  it("merges a repost into this run's draft, adding its photos", async () => {
    const original = post('new arrival', 2);
    const repost = post('restock', 3);
    graph.setPages([original, repost]);
    llm.answers.set('new arrival', sells(item('Muslin three piece')));
    llm.answers.set('restock', sells(item('muslin three piece', { prices: null })));
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    const made = await postRow(run.id, original.id);
    expect(await postRow(run.id, repost.id)).toMatchObject({
      result: 'merged',
      productIds: made.productIds,
    });
    expect(await runOf(run.id)).toMatchObject({ drafts: 1, merged: 1 });
    const images = await t.db
      .select()
      .from(schema.productImage)
      .where(eq(schema.productImage.productId, made.productIds[0]!));
    expect(images.map((image) => image.position).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('stops after the current post, and a resume skips the posts it handled', async () => {
    const posts = [post('one'), post('two'), post('three')];
    graph.setPages(posts);
    for (const graphPost of posts)
      llm.answers.set(graphPost.message!, sells(item(graphPost.message!)));
    const run = await startRun();
    llm.during = async () => {
      llm.during = null;
      await t.db
        .update(schema.productImport)
        .set({ status: 'stopping' })
        .where(eq(schema.productImport.id, run.id));
    };

    await runner.run(t.merchantA, run.id);

    expect(await runOf(run.id)).toMatchObject({ status: 'stopped', postsRead: 1, drafts: 1 });
    expect(ended).toHaveLength(1);

    await t.db
      .update(schema.productImport)
      .set({ status: 'queued', finishedAt: null })
      .where(eq(schema.productImport.id, run.id));
    await runner.run(t.merchantA, run.id);

    expect(llm.requests.map((request) => request.caption)).toEqual(['one', 'two', 'three']);
    expect(await runOf(run.id)).toMatchObject({ status: 'finished', postsRead: 3, drafts: 3 });
    expect(ended).toHaveLength(2);
  });

  it('ends a run stopped before its job started without reading anything', async () => {
    graph.setPages([post('one')]);
    const run = await startRun('stopping');

    await runner.run(t.merchantA, run.id);

    expect(graph.calls).toEqual([]);
    expect(await runOf(run.id)).toMatchObject({ status: 'stopped' });
  });

  it('fails the run when Graph refuses the token, keeping the drafts it made', async () => {
    const first = post('kept');
    graph.setPages([first], [post('never')]);
    llm.answers.set('kept', sells(item('Kept')));
    llm.during = async () => {
      llm.during = null;
      graph.refuse = new GraphError(400, 190, 'token expired');
    };
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(await runOf(run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'FACEBOOK_PERMISSION_MISSING',
      drafts: 1,
    });
    expect((await postRow(run.id, first.id)).productIds).toHaveLength(1);
    expect(ended).toHaveLength(1);
  });

  it('retries a Graph outage, and fails the run with it on the last attempt', async () => {
    graph.refuse = new GraphError(500, 2, 'unknown error');
    const run = await startRun();

    await expect(runner.run(t.merchantA, run.id)).rejects.toBeInstanceOf(GraphUnavailable);
    expect(await runOf(run.id)).toMatchObject({ status: 'running' });

    await runner.run(t.merchantA, run.id, { lastAttempt: true });
    expect(await runOf(run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'FACEBOOK_UNAVAILABLE',
    });
  });

  it('fails one post on an LLM failure, and the run on five in a row', async () => {
    const posts = Array.from({ length: LLM_FAILURES_TO_FAIL + 1 }, (_, index) => post(`p${index}`));
    graph.setPages(posts);
    for (const graphPost of posts) llm.answers.set(graphPost.message!, 'timeout');
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(llm.requests).toHaveLength(LLM_FAILURES_TO_FAIL);
    expect(await runOf(run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'IMPORT_NOT_AVAILABLE',
      failed: LLM_FAILURES_TO_FAIL,
    });
    expect(await postRow(run.id, posts[0]!.id)).toMatchObject({
      result: 'llm_failed',
    });
  });

  it('fails a post whose photo cannot be read, and goes on', async () => {
    const broken = { ...post('broken'), photoUrls: ['https://scontent.xx.fbcdn.net/broken.jpg'] };
    const fine = post('fine');
    graph.setPages([broken, fine]);
    llm.answers.set('fine', sells(item('Fine')));
    const run = await startRun();

    await runner.run(t.merchantA, run.id);

    expect(await postRow(run.id, broken.id)).toMatchObject({
      result: 'photo_unreadable',
    });
    expect(await runOf(run.id)).toMatchObject({ status: 'finished', failed: 1, drafts: 1 });
  });

  describe('Import anyway', () => {
    it('makes drafts of an in-catalog post with no LLM call', async () => {
      await seedProduct(t.db, t.merchantA, { name: 'Katan saree', status: 'active' });
      const known = post('known');
      graph.setPages([known]);
      llm.answers.set('known', sells(item('Katan saree')));
      const run = await startRun();
      await runner.run(t.merchantA, run.id);
      const row = await postRow(run.id, known.id);
      expect(row.result).toBe('in_catalog');

      await runner.importAnyway(t.merchantA, run.id, row.id);

      expect(llm.requests).toHaveLength(1);
      const after = await postRow(run.id, known.id);
      expect(after).toMatchObject({ result: 'draft' });
      expect(await productOf(after.productIds[0]!)).toMatchObject({
        name: 'Katan saree',
        status: 'draft',
      });
      expect(await runOf(run.id)).toMatchObject({ inCatalog: 0, drafts: 1 });
    });

    it('reads a not-product post again with the hint', async () => {
      const greeting = post('Eid offer');
      graph.setPages([greeting]);
      llm.answers.set('Eid offer', { kind: 'not_product', reason: 'Eid greeting', products: [] });
      const run = await startRun();
      await runner.run(t.merchantA, run.id);
      const row = await postRow(run.id, greeting.id);

      // As the route leaves it before queueing the job.
      await t.db
        .update(schema.productImportPost)
        .set({ anywayStatus: 'queued' })
        .where(eq(schema.productImportPost.id, row.id));
      llm.answers.set('Eid offer', sells(item('Eid special panjabi')));
      await runner.importAnyway(t.merchantA, run.id, row.id);

      expect(llm.requests.map((request) => request.hint)).toEqual([undefined, true]);
      expect(await postRow(run.id, greeting.id)).toMatchObject({
        result: 'draft',
        anywayStatus: null,
      });
      expect(await runOf(run.id)).toMatchObject({ notProducts: 0, drafts: 1 });
    });

    it('matches a re-read post against the catalog, as a run does', async () => {
      const katan = await seedProduct(t.db, t.merchantA, { name: 'Katan saree', status: 'active' });
      const onlyKnown = post('Puja wishes');
      const mixed = post('Puja collection');
      graph.setPages([onlyKnown, mixed]);
      const notProduct = { kind: 'not_product' as const, reason: 'Puja greeting', products: [] };
      llm.answers.set('Puja wishes', notProduct);
      llm.answers.set('Puja collection', notProduct);
      const run = await startRun();
      await runner.run(t.merchantA, run.id);

      llm.answers.set('Puja wishes', sells(item('Katan saree')));
      llm.answers.set('Puja collection', sells(item('Katan saree'), item('Puja kurti')));
      await runner.importAnyway(t.merchantA, run.id, (await postRow(run.id, onlyKnown.id)).id);
      await runner.importAnyway(t.merchantA, run.id, (await postRow(run.id, mixed.id)).id);

      expect(await postRow(run.id, onlyKnown.id)).toMatchObject({
        result: 'in_catalog',
        matchedProductIds: [katan.id],
        productIds: [],
      });
      const made = await postRow(run.id, mixed.id);
      expect(made).toMatchObject({ result: 'draft', matchedProductIds: [katan.id] });
      expect(made.productIds).toHaveLength(1);
      expect(await productOf(made.productIds[0]!)).toMatchObject({ name: 'Puja kurti' });
      expect(await runOf(run.id)).toMatchObject({ notProducts: 0, inCatalog: 1, drafts: 1 });
    });

    it('says when a re-read post still holds no product, or could not be read', async () => {
      const greeting = post('Eid wishes');
      const blurry = post('Blurry');
      graph.setPages([greeting, blurry]);
      const notProduct = { kind: 'not_product' as const, reason: 'Eid greeting', products: [] };
      llm.answers.set('Eid wishes', notProduct);
      llm.answers.set('Blurry', notProduct);
      const run = await startRun();
      await runner.run(t.merchantA, run.id);

      llm.answers.set('Blurry', 'timeout');
      await runner.importAnyway(t.merchantA, run.id, (await postRow(run.id, greeting.id)).id);
      await runner.importAnyway(t.merchantA, run.id, (await postRow(run.id, blurry.id)).id);

      expect(await postRow(run.id, greeting.id)).toMatchObject({
        result: 'not_a_product',
        note: 'Eid greeting',
        anywayStatus: 'no_product',
      });
      expect(await postRow(run.id, blurry.id)).toMatchObject({
        result: 'not_a_product',
        anywayStatus: 'failed',
      });
      expect(await runOf(run.id)).toMatchObject({ notProducts: 2, drafts: 0 });
    });

    it('marks the post failed when Graph is still down on the last attempt', async () => {
      const greeting = post('Eid card');
      graph.setPages([greeting]);
      llm.answers.set('Eid card', { kind: 'not_product', reason: 'Eid greeting', products: [] });
      const run = await startRun();
      await runner.run(t.merchantA, run.id);
      const row = await postRow(run.id, greeting.id);

      graph.refuse = new GraphError(500, 2, 'unknown error');
      await expect(
        runner.importAnyway(t.merchantA, run.id, row.id, { lastAttempt: false }),
      ).rejects.toThrow(GraphUnavailable);
      await runner.importAnyway(t.merchantA, run.id, row.id, { lastAttempt: true });
      graph.refuse = null;

      expect(await postRow(run.id, greeting.id)).toMatchObject({ anywayStatus: 'failed' });
    });

    it('never reads a post with no caption and no photo again', async () => {
      const empty: GraphImportPost = { ...post('x'), message: null, photoUrls: [] };
      graph.setPages([empty]);
      const run = await startRun();
      await runner.run(t.merchantA, run.id);
      const row = await postRow(run.id, empty.id);
      expect(row.result).toBe('no_caption_or_photo');

      await runner.importAnyway(t.merchantA, run.id, row.id);

      expect(llm.requests).toEqual([]);
      expect(await postRow(run.id, empty.id)).toMatchObject({
        result: 'no_caption_or_photo',
        anywayStatus: null,
      });
    });

    it('leaves a post that is no longer skipped alone', async () => {
      const made = post('made');
      graph.setPages([made]);
      llm.answers.set('made', sells(item('Made')));
      const run = await startRun();
      await runner.run(t.merchantA, run.id);
      const row = await postRow(run.id, made.id);

      await runner.importAnyway(t.merchantA, run.id, row.id);

      expect(llm.requests).toHaveLength(1);
      expect(
        await t.db
          .select()
          .from(schema.product)
          .where(and(eq(schema.product.merchantId, t.merchantA))),
      ).toHaveLength(1);
    });
  });
});
