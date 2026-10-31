import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createProductSchema,
  DEFAULT_COUNTRY,
  IMPORT_POST_PHOTO_MAX,
  postProductsSchema,
  PRODUCT_IMAGE_MAX_COUNT,
  regionDefaults,
  shopDayStart,
  type ErrorCode,
  canImportAnyway,
  isFailedResult,
  type ImportAnywayStatus,
  type ImportPostResult,
} from '@app/shared';
import { CryptoService } from '../../common/crypto.service';
import { CategoriesRepository } from '../categories/categories.repository';
import {
  MATCH_THRESHOLDS,
  productScores,
  type NamedProduct,
} from '../conversations/assistant/catalog-match';
import { LlmCallRepository } from '../conversations/assistant/llm-call.repository';
import type { TenantScope, Transaction } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import type { ProductImportPostRow, ProductImportRow } from '../database/schema/index';
import { withMerchant } from '../database/with-merchant';
import { LLM, type LlmCallRecord, type LlmClient } from '../llm/llm.types';
import { FacebookPageRepository } from '../messenger/page/facebook-page.repository';
import { META_GRAPH } from '../messenger/page/facebook-page.tokens';
import {
  isPermissionError,
  type GraphImportPost,
  type MetaGraphClient,
} from '../messenger/page/meta-graph.client';
import { idsOfGraphPost } from '../messenger/posts/post-links';
import { ProductPostRepository } from '../messenger/posts/product-post.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductImageRepository } from '../products/images/product-image.repository';
import {
  EMPTY_PRODUCT_STATE,
  planProductDocument,
} from '../products/options/product-document-plan';
import { ProductOptionsRepository } from '../products/options/product-options.repository';
import { ProductWriter } from '../products/options/product-writer';
import { ProductsRepository } from '../products/products.repository';
import { MerchantSettingsRepository } from '../settings/merchant-settings.repository';
import { promptPackFor } from '../llm/prompts/prompt-pack';
import type { NormalizedImage } from '../products/images/normalize-product-image';
import { ImportPhotos, type StoredImage } from './import-photos';
import { ImportRepository, type RunCounts } from './import.repository';
import { checkPostProducts, type CheckedPost, type PostDraft } from './post-drafts';

/** LLM failures in a row that fail the run. */
export const LLM_FAILURES_TO_FAIL = 5;
/** Photos sent to the LLM per post. */
export const LLM_PHOTOS_PER_POST = 4;

type RunEnd = 'finished' | 'stopped' | 'failed';

/** What a run reads once and keeps while it goes. */
interface RunContext {
  scope: TenantScope;
  importId: string;
  pageId: string;
  pageToken: string;
  currency: string;
  country: string;
  timeZone: string;
  categories: { id: string; name: string }[];
  /** The shop's products from before this run: a match is `in_catalog`. */
  catalog: NamedProduct[];
  /** This run's drafts: a match is merged into it. */
  drafts: NamedProduct[];
}

/** A product to write: new, or merged into one of the run's drafts when that still is one. */
interface ProductWrite {
  draft: PostDraft;
  images: StoredImage[];
  mergeInto?: string;
}

interface PostOutcome {
  result: ImportPostResult;
  note?: string | null;
  limitsApplied?: boolean;
  matchedProductIds?: string[];
  suggestedCategory?: string | null;
  extracted?: unknown;
  products?: ProductWrite[];
  llmCalls?: LlmCallRecord[];
  llmFailures?: 'keep' | 'reset' | 'bump';
  /** Moves the counts besides drafts and merged, which the write counts itself. */
  counts: RunCounts;
}

/** A Graph failure that is not a refused permission: worth the job's retries. */
export class GraphUnavailable extends Error {
  override name = 'GraphUnavailable';
}

/**
 * The worker's half of an import: reads a run's posts one at a time and
 * writes what each gave. Graph, the photo downloads, storage and the LLM all
 * run with no transaction open (invariant #1); each post's write is one short
 * `withMerchant` transaction. A retried job goes on from the run's cursor,
 * and the posts the run already handled are skipped by their rows.
 */
@Injectable()
export class ImportRunner {
  private readonly logger = new Logger(ImportRunner.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly imports: ImportRepository,
    private readonly products: ProductsRepository,
    private readonly options: ProductOptionsRepository,
    private readonly writer: ProductWriter,
    private readonly images: ProductImageRepository,
    private readonly categories: CategoriesRepository,
    private readonly posts: ProductPostRepository,
    private readonly pages: FacebookPageRepository,
    private readonly settings: MerchantSettingsRepository,
    private readonly llmCalls: LlmCallRepository,
    private readonly photos: ImportPhotos,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
    @Inject(LLM) private readonly llm: LlmClient | null,
  ) {}

  /**
   * Runs the import from where it is. `lastAttempt` turns a Graph or storage
   * outage into a failed run instead of an error for the queue to retry.
   */
  async run(merchantId: string, importId: string, { lastAttempt = false } = {}): Promise<void> {
    const scope: TenantScope = { merchantId };
    const claimed = await this.claim(scope, importId);
    if (claimed !== 'run') return;
    try {
      const end = await this.readPosts(scope, importId);
      await this.end(scope, importId, end);
    } catch (error) {
      if (!lastAttempt) throw error;
      this.logger.warn(`Import ${importId} failed after its retries: ${describe(error)}`);
      await this.end(scope, importId, {
        status: 'failed',
        errorCode:
          error instanceof GraphUnavailable ? 'FACEBOOK_UNAVAILABLE' : 'IMPORT_NOT_AVAILABLE',
      });
    }
  }

  /**
   * Import anyway on a skipped post. Throws while Graph or storage is down,
   * for BullMQ to retry; on the last attempt the post is marked `failed`.
   * Does nothing when the post can no longer be imported anyway.
   */
  async importAnyway(
    merchantId: string,
    importId: string,
    rowId: string,
    { lastAttempt = true }: { lastAttempt?: boolean } = {},
  ): Promise<void> {
    const scope: TenantScope = { merchantId };
    const row = await withMerchant(this.db, merchantId, (tx) =>
      this.imports.findPost(tx, scope, importId, rowId),
    );
    if (!row || !canImportAnyway(row.result)) return;
    let status: ImportAnywayStatus | null;
    try {
      status = await this.readAgain(scope, importId, row);
    } catch (error) {
      if (!lastAttempt) throw error;
      this.logger.warn(`Import anyway on post ${row.postId} failed: ${describe(error)}`);
      status = 'failed';
    }
    if (status) {
      await withMerchant(this.db, merchantId, (tx) =>
        this.imports.setAnywayStatus(tx, scope, importId, rowId, status),
      );
    }
  }

  /**
   * Reads a skipped post again. A post already in the catalog becomes drafts
   * of its stored output, unmatched, since the seller chose it. A not-product
   * post goes to the LLM with the hint, and its products are matched against
   * the catalog and this run's drafts as a run's are. Answers the post's
   * Import anyway status when nothing was written, null when the post moved.
   */
  private async readAgain(
    scope: TenantScope,
    importId: string,
    row: ProductImportPostRow,
  ): Promise<ImportAnywayStatus | null> {
    const { merchantId } = scope;
    const context = await this.context(scope, importId);
    if (!context) return 'failed';
    const graph = this.requireGraph();

    let fresh: GraphImportPost | null;
    try {
      fresh = await graph.getImportPost(context.pageToken, row.postId);
    } catch (error) {
      if (isPermissionError(error)) return 'failed';
      throw new GraphUnavailable(describe(error));
    }
    const post: GraphImportPost = fresh ?? {
      id: row.postId,
      message: row.caption,
      permalinkUrl: row.permalinkUrl,
      createdTime: row.createdTime?.toISOString() ?? null,
      photoUrls: [],
    };

    const read = await this.photos.read(post.photoUrls);
    if (!read) return 'failed';
    const stored = await this.photos.store(merchantId, read);
    const inCatalog = row.result === 'in_catalog';
    const undo: RunCounts = inCatalog ? { inCatalog: -1 } : { notProducts: -1 };

    let checked: CheckedPost;
    let llmCalls: LlmCallRecord[] = [];
    let extracted: unknown = row.extracted;
    if (inCatalog) {
      const parsed = postProductsSchema.safeParse(row.extracted);
      if (!parsed.success) {
        await this.photos.discard(merchantId, stored);
        return 'failed';
      }
      checked = checkPostProducts(parsed.data, context);
    } else {
      const result = await this.requireLlm().extractProductsFromPost({
        caption: post.message,
        photos: stored.slice(0, LLM_PHOTOS_PER_POST).map((image) => image.url),
        currency: context.currency,
        pack: promptPackFor(context.country),
        categories: context.categories.map((category) => category.name),
        hint: true,
      });
      llmCalls = [{ ...result.usage, outcome: result.ok ? 'ok' : result.reason }];
      if (!result.ok) {
        await this.recordCalls(scope, importId, llmCalls);
        await this.photos.discard(merchantId, stored);
        return 'failed';
      }
      extracted = result.value;
      checked = checkPostProducts(result.value, context);
    }

    if (checked.kind === 'not_product') {
      await this.recordCalls(scope, importId, llmCalls);
      await this.photos.discard(merchantId, stored);
      return 'no_product';
    }

    const known = inCatalog
      ? checked.drafts.map((): string[] => [])
      : checked.drafts.map((draft) => matchesOf(draft, context.catalog));
    if (known.every((matches) => matches.length > 0)) {
      await this.photos.discard(merchantId, stored);
      await this.write(context, post, {
        result: 'in_catalog',
        matchedProductIds: [...new Set(known.flat())],
        extracted,
        llmCalls,
        counts: { ...undo, inCatalog: 1 },
      });
      return null;
    }
    const left: CheckedPost = {
      ...checked,
      drafts: checked.drafts.filter((_, index) => known[index]!.length === 0),
    };
    const products = await this.withImages(merchantId, left, { read, stored }, (draft) =>
      inCatalog ? undefined : matchesOf(draft, context.drafts)[0],
    );
    await this.write(context, post, {
      result: 'draft',
      limitsApplied: checked.flagged,
      matchedProductIds: [...new Set(known.flat())],
      suggestedCategory: firstSuggestion(left),
      extracted,
      products,
      llmCalls,
      counts: undo,
    });
    return null;
  }

  /** queued -> running. A stop that came before the job started ends the run here. */
  private async claim(scope: TenantScope, importId: string): Promise<'run' | 'skip'> {
    const outcome = await withMerchant(this.db, scope.merchantId, async (tx) => {
      const run = await this.imports.findRun(tx, scope, importId, { lock: true });
      if (!run) return 'skip' as const;
      if (run.status === 'stopping') return 'stop' as const;
      if (run.status !== 'queued' && run.status !== 'running') return 'skip' as const;
      await this.imports.updateRun(tx, scope, importId, {
        status: 'running',
        startedAt: run.startedAt ?? new Date(),
        finishedAt: null,
        errorCode: null,
      });
      return 'run' as const;
    });
    if (outcome === 'stop') {
      await this.end(scope, importId, { status: 'stopped' });
      return 'skip';
    }
    return outcome;
  }

  private async readPosts(
    scope: TenantScope,
    importId: string,
  ): Promise<{ status: RunEnd; errorCode?: ErrorCode }> {
    const context = await this.context(scope, importId);
    if (!context) return { status: 'failed', errorCode: 'FACEBOOK_PERMISSION_MISSING' };
    if (!this.llm) return { status: 'failed', errorCode: 'IMPORT_NOT_AVAILABLE' };
    const graph = this.requireGraph();

    for (;;) {
      const run = await this.findRun(scope, importId);
      if (!run) return { status: 'failed' };
      if (run.status === 'stopping') return { status: 'stopped' };

      let page;
      try {
        page = await graph.listPublishedPosts(context.pageToken, context.pageId, {
          since: shopDayStart(run.since, context.timeZone),
          until: shopDayStart(dayAfter(run.until), context.timeZone),
          after: run.cursor,
        });
      } catch (error) {
        if (isPermissionError(error)) {
          return { status: 'failed', errorCode: 'FACEBOOK_PERMISSION_MISSING' };
        }
        throw new GraphUnavailable(describe(error));
      }

      if (!page.after) {
        await withMerchant(this.db, scope.merchantId, (tx) =>
          this.imports.updateRun(tx, scope, importId, {
            postsTotal: run.postsRead + page.posts.length,
          }),
        );
      }

      for (const post of page.posts) {
        const current = await this.findRun(scope, importId);
        if (current?.status === 'stopping') return { status: 'stopped' };
        const failures = await this.handle(context, post);
        if (failures >= LLM_FAILURES_TO_FAIL) {
          return { status: 'failed', errorCode: 'IMPORT_NOT_AVAILABLE' };
        }
      }

      if (!page.after) return { status: 'finished' };
      await withMerchant(this.db, scope.merchantId, (tx) =>
        this.imports.updateRun(tx, scope, importId, { cursor: page.after }),
      );
    }
  }

  /** One post, skipped, read or failed. Returns the run's LLM failures in a row after it. */
  private async handle(context: RunContext, post: GraphImportPost): Promise<number> {
    const { scope, importId } = context;
    const ids = idsOfGraphPost(post);
    const keys = ids ? [ids.postId, ...(ids.aliasId ? [ids.aliasId] : [])] : [];
    const seen = await withMerchant(this.db, scope.merchantId, async (tx) => {
      const own = await this.imports.findPostInRun(tx, scope, importId, post.id);
      // A post this run already handled is done; only a failed one is read again.
      if (own && !isFailedResult(own.result)) return 'done' as const;
      const before = await this.imports.importedBefore(tx, scope, importId, post.id, keys);
      if (before) return { kind: 'imported' as const, productIds: before.productIds };
      return { kind: own ? ('retry' as const) : ('new' as const) };
    });
    if (seen === 'done') return 0;
    const counted: RunCounts = seen.kind === 'retry' ? { failed: -1 } : { postsRead: 1 };

    if (seen.kind === 'imported') {
      return this.write(context, post, {
        result: 'already_imported',
        matchedProductIds: seen.productIds,
        counts: { ...counted, alreadyImported: 1 },
      });
    }
    if (!post.message && post.photoUrls.length === 0) {
      return this.write(context, post, {
        result: 'no_caption_or_photo',
        counts: { ...counted, notProducts: 1 },
      });
    }

    const read = await this.photos.read(post.photoUrls);
    if (!read) {
      return this.write(context, post, {
        result: 'photo_unreadable',
        counts: { ...counted, failed: 1 },
      });
    }
    const stored = await this.photos.store(scope.merchantId, read);

    const result = await this.requireLlm().extractProductsFromPost({
      caption: post.message,
      photos: stored.slice(0, LLM_PHOTOS_PER_POST).map((image) => image.url),
      currency: context.currency,
      pack: promptPackFor(context.country),
      categories: context.categories.map((category) => category.name),
    });
    const llmCalls: LlmCallRecord[] = [
      { ...result.usage, outcome: result.ok ? 'ok' : result.reason },
    ];
    if (!result.ok) {
      await this.photos.discard(scope.merchantId, stored);
      return this.write(context, post, {
        result: 'llm_failed',
        llmCalls,
        llmFailures: 'bump',
        counts: { ...counted, failed: 1 },
      });
    }

    const checked = checkPostProducts(result.value, context);
    if (checked.kind === 'not_product') {
      await this.photos.discard(scope.merchantId, stored);
      return this.write(context, post, {
        result: checked.result,
        note: checked.note,
        llmCalls,
        llmFailures: 'reset',
        counts: { ...counted, notProducts: 1 },
      });
    }

    const known = checked.drafts.map((draft) => matchesOf(draft, context.catalog));
    if (known.every((matches) => matches.length > 0)) {
      await this.photos.discard(scope.merchantId, stored);
      return this.write(context, post, {
        result: 'in_catalog',
        matchedProductIds: [...new Set(known.flat())],
        extracted: result.value,
        llmCalls,
        llmFailures: 'reset',
        counts: { ...counted, inCatalog: 1 },
      });
    }

    const fresh: CheckedPost = {
      ...checked,
      drafts: checked.drafts.filter((_, index) => known[index]!.length === 0),
    };
    const products = await this.withImages(
      scope.merchantId,
      fresh,
      { read, stored },
      (draft) => matchesOf(draft, context.drafts)[0],
    );
    return this.write(context, post, {
      result: 'draft',
      limitsApplied: checked.flagged,
      matchedProductIds: [...new Set(known.flat())],
      suggestedCategory: firstSuggestion(fresh),
      extracted: result.value,
      products,
      llmCalls,
      llmFailures: 'reset',
      counts: counted,
    });
  }

  /**
   * Pairs each draft with its own copy of the photos: the first takes the
   * copies already stored, the rest get new ones, since an image row belongs
   * to one product.
   */
  private async withImages(
    merchantId: string,
    checked: Extract<CheckedPost, { kind: 'products' }>,
    photos: { read: NormalizedImage[]; stored: StoredImage[] },
    mergeTarget: (draft: PostDraft) => string | undefined,
  ): Promise<ProductWrite[]> {
    const writes: ProductWrite[] = [];
    for (const [index, draft] of checked.drafts.entries()) {
      const images = index === 0 ? photos.stored : await this.photos.store(merchantId, photos.read);
      writes.push({ draft, images, mergeInto: mergeTarget(draft) });
    }
    return writes;
  }

  /**
   * One post's write in one short transaction. A product write that loses a
   * race fails only this post; its photos are left to the orphan sweep.
   * Returns the run's LLM failures in a row after it.
   */
  private async write(
    context: RunContext,
    post: GraphImportPost,
    outcome: PostOutcome,
  ): Promise<number> {
    const { scope, importId } = context;
    const ids = idsOfGraphPost(post);
    try {
      const made: NamedProduct[] = [];
      const failures = await withMerchant(this.db, scope.merchantId, async (tx) => {
        let created = 0;
        let merged = 0;
        const productIds: string[] = [];
        for (const product of outcome.products ?? []) {
          const into = product.mergeInto
            ? await this.mergeInto(tx, scope, product.mergeInto, product.images)
            : false;
          if (into) {
            merged += 1;
            productIds.push(product.mergeInto!);
          } else {
            const id = await this.createDraft(tx, scope, product);
            made.push({ id, ...namedOf(product.draft) });
            created += 1;
            productIds.push(id);
          }
        }
        const result: ImportPostResult =
          outcome.products === undefined ? outcome.result : created > 0 ? 'draft' : 'merged';
        await this.imports.upsertPost(tx, scope, importId, {
          postId: post.id,
          createdTime: timeOrNull(post.createdTime),
          caption: post.message,
          permalinkUrl: post.permalinkUrl,
          photoCount: Math.min(post.photoUrls.length, IMPORT_POST_PHOTO_MAX),
          result,
          limitsApplied: outcome.limitsApplied ?? false,
          anywayStatus: null,
          note: outcome.note ?? null,
          matchedProductIds: outcome.matchedProductIds ?? [],
          suggestedCategory: outcome.suggestedCategory ?? null,
          productIds,
          extracted: outcome.extracted ?? null,
        });
        // product_post holds one product per post; a post with several links none.
        if (productIds.length === 1 && ids) {
          await this.posts.linkIfFree(tx, scope, productIds[0]!, {
            ...ids,
            url: post.permalinkUrl,
            caption: post.message,
          });
        }
        await this.llmCalls.insertForImport(tx, scope, importId, outcome.llmCalls ?? []);
        return this.imports.addCounts(
          tx,
          scope,
          importId,
          { ...outcome.counts, drafts: created, merged },
          outcome.llmFailures ?? 'keep',
        );
      });
      // Only once committed: a later repost in this run merges into these.
      context.drafts.push(...made);
      return failures;
    } catch (error) {
      if (!outcome.products?.length) throw error;
      this.logger.warn(`Import ${importId} could not write post ${post.id}: ${describe(error)}`);
      const { postsRead, failed } = outcome.counts;
      return this.write(context, post, {
        result: 'write_failed',
        llmCalls: outcome.llmCalls,
        llmFailures: outcome.llmFailures,
        counts: { postsRead, failed: (failed ?? 0) + 1 },
      });
    }
  }

  private async createDraft(
    tx: Transaction,
    scope: TenantScope,
    { draft, images }: ProductWrite,
  ): Promise<string> {
    const doc = createProductSchema.parse(draft.document);
    const row = await this.products.insertProduct(tx, scope, {
      name: doc.name,
      description: doc.description,
      status: 'draft',
      aliases: doc.aliases,
      customDelivery: false,
    });
    await this.writer.apply(tx, scope, row.id, planProductDocument(EMPTY_PRODUCT_STATE, doc));
    for (const [position, image] of images.entries()) {
      await this.images.insert(tx, scope, { ...imageRow(image), productId: row.id, position });
    }
    if (images[0]) await this.products.setCoverImage(tx, scope, row.id, images[0].id);
    if (doc.categoryIds.length > 0) {
      // The same lock category deletion takes; a category deleted since the read is left off.
      await this.categories.lockCategories(tx, scope);
      const live = await this.categories.listLive(tx, scope);
      const linked = doc.categoryIds.filter((id) => live.some((category) => category.id === id));
      await this.products.setCategories(tx, scope, row.id, linked);
    }
    return row.id;
  }

  /** Adds the photos to one of the run's drafts, up to the gallery's cap. False when it is no longer a draft. */
  private async mergeInto(
    tx: Transaction,
    scope: TenantScope,
    productId: string,
    images: StoredImage[],
  ): Promise<boolean> {
    const product = await this.products.findProduct(tx, scope, productId, { lock: true });
    if (product?.status !== 'draft') return false;
    const count = await this.images.count(tx, scope, productId);
    const room = images.slice(0, Math.max(PRODUCT_IMAGE_MAX_COUNT - count, 0));
    for (const [index, image] of room.entries()) {
      await this.images.insert(tx, scope, {
        ...imageRow(image),
        productId,
        position: count + index,
      });
    }
    if (product.coverImageId === null && room[0]) {
      await this.products.setCoverImage(tx, scope, productId, room[0].id);
    }
    return true;
  }

  /** The LLM calls of an Import anyway that wrote nothing. */
  private async recordCalls(
    scope: TenantScope,
    importId: string,
    calls: LlmCallRecord[],
  ): Promise<void> {
    await withMerchant(this.db, scope.merchantId, (tx) =>
      this.llmCalls.insertForImport(tx, scope, importId, calls),
    );
  }

  private async end(
    scope: TenantScope,
    importId: string,
    { status, errorCode }: { status: RunEnd; errorCode?: ErrorCode },
  ): Promise<void> {
    const finishedAt = new Date();
    await withMerchant(this.db, scope.merchantId, (tx) =>
      this.imports.updateRun(tx, scope, importId, {
        status,
        errorCode: status === 'failed' ? (errorCode ?? 'IMPORT_NOT_AVAILABLE') : null,
        finishedAt,
      }),
    );
    await this.notifications.importFinished(scope.merchantId, importId, finishedAt);
  }

  private findRun(scope: TenantScope, importId: string): Promise<ProductImportRow | undefined> {
    return withMerchant(this.db, scope.merchantId, (tx) =>
      this.imports.findRun(tx, scope, importId),
    );
  }

  /** The run's Page, region, categories and products, or null when the Page is gone. */
  private async context(scope: TenantScope, importId: string): Promise<RunContext | null> {
    const read = await withMerchant(this.db, scope.merchantId, async (tx) => {
      const page = await this.pages.findForMerchant(tx, scope);
      if (!page) return null;
      const settings = await this.settings.find(tx, scope);
      const categories = await this.categories.listLive(tx, scope);
      const named = await this.imports.namedProducts(tx, scope);
      const { options, values } = await this.options.listForProducts(
        tx,
        scope,
        named.map((product) => product.id),
      );
      const runDrafts = new Set(await this.imports.runDraftIds(tx, scope, importId));
      return { page, settings, categories, named, options, values, runDrafts };
    });
    if (!read) return null;

    const region = read.settings ?? {
      ...regionDefaults(DEFAULT_COUNTRY),
      country: DEFAULT_COUNTRY,
    };
    const products: NamedProduct[] = read.named.map((product) => ({
      ...product,
      options: read.options
        .filter((option) => option.productId === product.id)
        .map((option) => ({
          id: option.id,
          name: option.name,
          values: read.values
            .filter((value) => value.optionId === option.id)
            .map((value) => ({ id: value.id, value: value.value })),
        })),
    }));
    return {
      scope,
      importId,
      pageId: read.page.pageId,
      pageToken: this.crypto.decrypt(read.page.accessToken),
      currency: region.currency,
      country: region.country,
      timeZone: region.timeZone,
      categories: read.categories.map(({ id, name }) => ({ id, name })),
      catalog: products.filter((product) => !read.runDrafts.has(product.id)),
      drafts: products.filter((product) => read.runDrafts.has(product.id)),
    };
  }

  private requireGraph(): MetaGraphClient {
    if (!this.graph) throw new Error('An import job ran without a Graph client');
    return this.graph;
  }

  private requireLlm(): LlmClient {
    if (!this.llm) throw new Error('An import job ran without an LLM');
    return this.llm;
  }
}

/**
 * The products a draft repeats: matched by name and aliases (matchProduct's
 * scoring), and only at a score of 1, every word of one name in the other.
 */
export function matchesOf(draft: PostDraft, among: readonly NamedProduct[]): string[] {
  if (among.length === 0) return [];
  const { name, aliases } = draft.document;
  return productScores([name, ...aliases], { products: among }, MATCH_THRESHOLDS)
    .filter((entry) => entry.score >= 1)
    .map((entry) => entry.id);
}

function namedOf(draft: PostDraft): Omit<NamedProduct, 'id'> {
  return {
    name: draft.document.name,
    aliases: draft.document.aliases,
    options: draft.document.options.map((option, index) => ({
      id: `new-${index}`,
      name: option.name,
      values: option.values.map((value, position) => ({
        id: `new-${index}-${position}`,
        value: value.value,
      })),
    })),
  };
}

function firstSuggestion(checked: Extract<CheckedPost, { kind: 'products' }>): string | null {
  return checked.drafts.find((draft) => draft.suggestedCategory)?.suggestedCategory ?? null;
}

function imageRow(image: StoredImage) {
  return {
    id: image.id,
    storageKey: image.storageKey,
    width: image.width,
    height: image.height,
    byteSize: image.byteSize,
  };
}

/** The calendar day after a `yyyy-MM-dd` day. */
export function dayAfter(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function timeOrNull(value: string | null): Date | null {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
}

/** The error's name and message, never a request or a token (GraphError carries neither). */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
