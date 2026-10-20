import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  DEFAULT_COUNTRY,
  regionDefaults,
  shopToday,
  type ActivateImport,
  type ActivateImportResult,
  type CreateImport,
  type FacebookImportAccess,
  type ImportPost,
  type ImportPostListResponse,
  type ImportRun,
  type ImportRunListResponse,
  type ListImportPostsQuery,
  type ListImportsQuery,
} from '@app/shared';
import { CryptoService } from '../../common/crypto.service';
import { AppConfig } from '../config/app.config';
import { messengerPageNotConnected } from '../conversations/conversation-errors';
import type { TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { uniqueViolationConstraint } from '../database/pg-errors';
import {
  PRODUCT_IMPORT_ACTIVE_UIDX,
  type ProductImportPostRow,
  type ProductImportRow,
} from '../database/schema/index';
import { withMerchant } from '../database/with-merchant';
import {
  facebookUnavailable,
  messengerNotConfigured,
} from '../messenger/page/facebook-page-errors';
import { FacebookPageRepository } from '../messenger/page/facebook-page.repository';
import { META_GRAPH } from '../messenger/page/facebook-page.tokens';
import {
  isPermissionError,
  PAGE_OPTIONAL_SCOPES,
  type MetaGraphClient,
} from '../messenger/page/meta-graph.client';
import { allowedUrl } from '../messenger/posts/post-links';
import { facebookPermissionMissing } from '../messenger/posts/product-post-errors';
import { productImageKeys } from '../products/images/product-image-keys';
import { ProductsRepository } from '../products/products.repository';
import {
  IMPORT_JOB_RETENTION,
  IMPORT_POST_JOB,
  IMPORT_RUN_JOB,
  IMPORTS_QUEUE,
  type ImportPostJob,
  type ImportRunJob,
} from '../queue/queue.constants';
import { MerchantSettingsRepository } from '../settings/merchant-settings.repository';
import { ObjectStorage } from '../storage/object-storage';
import {
  importAlreadyRunning,
  importNotAvailable,
  importNotFound,
  importNotRunning,
  importNotStopped,
  importPostNotFound,
  importPostNotSkipped,
  importUntilInFuture,
} from './import-errors';
import { ImportRepository, SKIPPED_RESULTS, type ImportProductSummary } from './import.repository';

/**
 * The import routes. Graph runs before any transaction (invariant #1); the
 * run itself is the worker's (ImportRunner). The merchant always comes from
 * the session.
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @InjectQueue(IMPORTS_QUEUE) private readonly queue: Queue,
    private readonly imports: ImportRepository,
    private readonly products: ProductsRepository,
    private readonly pages: FacebookPageRepository,
    private readonly settings: MerchantSettingsRepository,
    private readonly storage: ObjectStorage,
    private readonly crypto: CryptoService,
    private readonly config: AppConfig,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
  ) {}

  /** Whether a run could read the Page's posts now: one `published_posts` call. */
  async access(scope: TenantScope): Promise<FacebookImportAccess> {
    const graph = this.graph;
    if (!graph) throw messengerNotConfigured();
    const page = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.pages.findForMerchant(tx, scope),
    );
    if (!page) return { pageConnected: false, canReadPosts: false };
    return { pageConnected: true, canReadPosts: await this.canReadPosts(graph, page) };
  }

  async create(scope: TenantScope, userId: string | null, body: CreateImport): Promise<ImportRun> {
    const graph = this.graph;
    if (!graph || !this.config.get('LLM_API_KEY')) throw importNotAvailable();
    const { page, timeZone, running } = await withMerchant(
      this.db,
      scope.merchantId,
      async (tx) => ({
        page: await this.pages.findForMerchant(tx, scope),
        timeZone:
          (await this.settings.find(tx, scope))?.timeZone ??
          regionDefaults(DEFAULT_COUNTRY).timeZone,
        running: (await this.imports.listRuns(tx, scope, { offset: 0, limit: 1 }))[0],
      }),
    );
    const today = shopToday(timeZone);
    if (body.until > today) throw importUntilInFuture(today);
    if (!page) throw messengerPageNotConnected();
    // A cheap refusal before Graph; the unique index decides.
    if (running && ['queued', 'running', 'stopping'].includes(running.status)) {
      throw importAlreadyRunning();
    }
    if (!(await this.canReadPosts(graph, page))) {
      throw facebookPermissionMissing(PAGE_OPTIONAL_SCOPES[0]);
    }

    const run = await this.guardRunning(() =>
      withMerchant(this.db, scope.merchantId, (tx) =>
        this.imports.insertRun(tx, scope, {
          since: body.since,
          until: body.until,
          startedBy: userId,
        }),
      ),
    );
    await this.enqueueRun(scope, run.id);
    return this.view(scope, run);
  }

  list(scope: TenantScope, { page, limit }: ListImportsQuery): Promise<ImportRunListResponse> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const runs = await this.imports.listRuns(tx, scope, { offset: (page - 1) * limit, limit });
      const left = await this.imports.leftToReview(
        tx,
        scope,
        runs.map((run) => run.id),
      );
      return {
        data: runs.map((run) => toImportRun(run, left.get(run.id) ?? 0)),
        total: await this.imports.countRuns(tx, scope),
      };
    });
  }

  async get(scope: TenantScope, id: string): Promise<ImportRun> {
    const run = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.imports.findRun(tx, scope, id),
    );
    if (!run) throw importNotFound(id);
    return this.view(scope, run);
  }

  posts(
    scope: TenantScope,
    id: string,
    { result, page, limit }: ListImportPostsQuery,
  ): Promise<ImportPostListResponse> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.imports.findRun(tx, scope, id))) throw importNotFound(id);
      const rows = await this.imports.listPosts(tx, scope, id, {
        filter: result,
        offset: (page - 1) * limit,
        limit,
      });
      const summaries = await this.imports.productSummaries(
        tx,
        scope,
        rows.flatMap((row) => [...row.productIds, ...row.matchedProductIds]),
      );
      const keep = (product: ImportProductSummary) =>
        result === 'needs_info'
          ? product.status === 'draft' && product.needsPrice
          : result === 'ready'
            ? product.status === 'draft' && !product.needsPrice
            : true;
      return {
        data: rows.map((row) => this.toImportPost(scope, row, summaries, keep)),
        total: await this.imports.countPosts(tx, scope, id, result),
      };
    });
  }

  /** Stop after the current post: the worker sees `stopping` before the next one. */
  async stop(scope: TenantScope, id: string): Promise<ImportRun> {
    const run = await withMerchant(this.db, scope.merchantId, async (tx) => {
      const found = await this.imports.findRun(tx, scope, id, { lock: true });
      if (!found) throw importNotFound(id);
      if (found.status !== 'queued' && found.status !== 'running') throw importNotRunning(id);
      await this.imports.updateRun(tx, scope, id, { status: 'stopping' });
      return { ...found, status: 'stopping' as const };
    });
    return this.view(scope, run);
  }

  /** Queues a stopped run again; it goes on from its cursor and skips the posts it handled. */
  async resume(scope: TenantScope, id: string): Promise<ImportRun> {
    const run = await this.guardRunning(() =>
      withMerchant(this.db, scope.merchantId, async (tx) => {
        const found = await this.imports.findRun(tx, scope, id, { lock: true });
        if (!found) throw importNotFound(id);
        if (found.status !== 'stopped') throw importNotStopped(id);
        await this.imports.updateRun(tx, scope, id, { status: 'queued', finishedAt: null });
        return { ...found, status: 'queued' as const, finishedAt: null };
      }),
    );
    await this.enqueueRun(scope, id);
    return this.view(scope, run);
  }

  /** Import anyway: a small job on the same queue, allowed while another run goes. */
  async importAnyway(scope: TenantScope, id: string, postId: string): Promise<ImportPost> {
    const row = await withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.imports.findRun(tx, scope, id))) throw importNotFound(id);
      const found = await this.imports.findPost(tx, scope, id, postId);
      if (!found) throw importPostNotFound(postId);
      if (!SKIPPED_RESULTS.includes(found.result)) throw importPostNotSkipped(postId);
      return found;
    });
    if (!this.graph || !this.config.get('LLM_API_KEY')) throw importNotAvailable();
    const data: ImportPostJob = { merchantId: scope.merchantId, importId: id, postId };
    await this.queue.add(IMPORT_POST_JOB, data, {
      ...IMPORT_JOB_RETENTION,
      jobId: `import-post-${id}-${postId}`,
    });
    const summaries = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.imports.productSummaries(tx, scope, row.matchedProductIds),
    );
    return this.toImportPost(scope, row, summaries, () => true);
  }

  /**
   * Fills every empty stock with `startingStock` and makes each draft active,
   * one product per transaction. A product that is not this run's, not a
   * draft, or still missing a price is reported, and the rest go ahead.
   */
  async activate(
    scope: TenantScope,
    id: string,
    { productIds, startingStock }: ActivateImport,
  ): Promise<ActivateImportResult> {
    await this.get(scope, id);
    const result: ActivateImportResult = { activated: [], failed: [] };
    for (const productId of [...new Set(productIds)]) {
      const outcome = await withMerchant(this.db, scope.merchantId, async (tx) => {
        if (!(await this.imports.isRunProduct(tx, scope, id, productId))) {
          return 'PRODUCT_NOT_FOUND' as const;
        }
        const product = await this.products.findProduct(tx, scope, productId, { lock: true });
        if (!product) return 'PRODUCT_NOT_FOUND' as const;
        if (product.status !== 'draft') return 'PRODUCT_NOT_DRAFT' as const;
        const variants = await this.products.liveVariants(tx, scope, [productId]);
        if (variants.length === 0 || variants.some((variant) => variant.price === null)) {
          return 'PRODUCT_PRICE_MISSING' as const;
        }
        for (const variant of variants.filter((entry) => entry.stock === null)) {
          await this.products.updateVariant(tx, scope, variant.id, { stock: startingStock });
        }
        await this.products.updateProduct(tx, scope, productId, { status: 'active' });
        return 'activated' as const;
      });
      if (outcome === 'activated') result.activated.push(productId);
      else result.failed.push({ productId, code: outcome });
    }
    return result;
  }

  private async canReadPosts(
    graph: MetaGraphClient,
    page: { pageId: string; accessToken: string },
  ): Promise<boolean> {
    try {
      const now = new Date();
      await graph.listPublishedPosts(this.crypto.decrypt(page.accessToken), page.pageId, {
        since: new Date(now.getTime() - 24 * 3_600_000),
        until: now,
        limit: 1,
      });
      return true;
    } catch (error) {
      if (isPermissionError(error)) return false;
      throw facebookUnavailable();
    }
  }

  private async guardRunning<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (uniqueViolationConstraint(error) === PRODUCT_IMPORT_ACTIVE_UIDX) {
        throw importAlreadyRunning();
      }
      throw error;
    }
  }

  private async enqueueRun(scope: TenantScope, importId: string): Promise<void> {
    const data: ImportRunJob = { merchantId: scope.merchantId, importId };
    await this.queue.add(IMPORT_RUN_JOB, data, {
      ...IMPORT_JOB_RETENTION,
      jobId: `import-${importId}`,
    });
  }

  private async view(scope: TenantScope, run: ProductImportRow): Promise<ImportRun> {
    const left = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.imports.leftToReview(tx, scope, [run.id]),
    );
    return toImportRun(run, left.get(run.id) ?? 0);
  }

  private toImportPost(
    scope: TenantScope,
    row: ProductImportPostRow,
    summaries: Map<string, ImportProductSummary>,
    keep: (product: ImportProductSummary) => boolean,
  ): ImportPost {
    const found = (ids: string[]) =>
      ids.flatMap((productId) => {
        const summary = summaries.get(productId);
        return summary ? [summary] : [];
      });
    const url = row.permalinkUrl ? allowedUrl(row.permalinkUrl) : null;
    return {
      id: row.id,
      postId: row.postId,
      createdTime: row.createdTime?.toISOString() ?? null,
      caption: row.caption,
      url: url ? url.toString() : null,
      photoCount: row.photoCount,
      result: row.result,
      reason: row.reason,
      suggestedCategory: row.suggestedCategory,
      matchedProducts: found(row.matchedProductIds).map(({ id, name }) => ({ id, name })),
      products: found(row.productIds)
        .filter(keep)
        .map((product) => ({
          id: product.id,
          name: product.name,
          status: product.status,
          coverThumbnailUrl:
            product.coverImageId === null
              ? null
              : this.storage.publicUrl(
                  productImageKeys(scope.merchantId, product.coverImageId).thumbnail,
                ),
          variantCount: product.variantCount,
          needsPrice: product.needsPrice,
          needsStock: product.needsStock,
        })),
    };
  }
}

function toImportRun(row: ProductImportRow, leftToReview: number): ImportRun {
  return {
    id: row.id,
    source: row.source,
    since: row.since,
    until: row.until,
    status: row.status,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    postsTotal: row.postsTotal,
    postsRead: row.postsRead,
    drafts: row.drafts,
    merged: row.merged,
    notProducts: row.notProducts,
    inCatalog: row.inCatalog,
    alreadyImported: row.alreadyImported,
    failed: row.failed,
    leftToReview,
  };
}
