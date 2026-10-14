import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateProductPost,
  PagePost,
  PagePostListResponse,
  ProductPost,
  ProductPostListResponse,
} from '@app/shared';
import { CryptoService } from '../../../common/crypto.service';
import type { Executor, TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import type { ProductPostRow } from '../../database/schema/index';
import { withMerchant } from '../../database/with-merchant';
import { productNotFound } from '../../products/product-errors';
import { ProductsRepository } from '../../products/products.repository';
import { messengerPageNotConnected } from '../../conversations/conversation-errors';
import { facebookUnavailable, messengerNotConfigured } from '../page/facebook-page-errors';
import { FacebookPageRepository } from '../page/facebook-page.repository';
import { META_GRAPH } from '../page/facebook-page.tokens';
import {
  isPermissionError,
  PAGE_OPTIONAL_SCOPES,
  type GraphPost,
  type MetaGraphClient,
} from '../page/meta-graph.client';
import { allowedUrl, followShortLink, graphPostId, idsOfGraphPost, postRefOf } from './post-links';
import {
  facebookPermissionMissing,
  productPostArchived,
  productPostInvalidUrl,
  productPostNotFound,
  productPostTaken,
} from './product-post-errors';
import { ProductPostRepository, type PostDetails } from './product-post.repository';
import { POST_LINK_FETCH } from './shared-post.resolver';

/**
 * The product page's post links. Graph and the short-link hop run before the
 * write transaction (invariant #1); the transaction re-checks the product and
 * who holds the post.
 */
@Injectable()
export class ProductPostsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly posts: ProductPostRepository,
    private readonly products: ProductsRepository,
    private readonly pages: FacebookPageRepository,
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
    @Inject(POST_LINK_FETCH) private readonly fetchFn: typeof fetch,
  ) {}

  list(scope: TenantScope, productId: string): Promise<ProductPostListResponse> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.products.findProduct(tx, scope, productId))) {
        throw productNotFound(productId);
      }
      return { data: (await this.posts.listForProduct(tx, scope, productId)).map(toProductPost) };
    });
  }

  async create(
    scope: TenantScope,
    productId: string,
    body: CreateProductPost,
  ): Promise<ProductPost> {
    const post =
      'url' in body
        ? await this.fromUrl(scope, body.url)
        : await this.fromPicker(scope, body.pagePostId);
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      await this.sellable(tx, scope, productId);
      const keys = post.aliasId ? [post.postId, post.aliasId] : [post.postId];
      const held = await this.posts.findByKeys(tx, scope, keys);
      const owner = held.find((row) => row.status === 'linked' && row.productId !== productId);
      if (owner) throw productPostTaken(owner.productId, owner.productName);
      const existing = held.find((row) => row.status === 'linked') ?? held[0];
      const row = existing
        ? await this.posts.relink(tx, scope, existing.id, productId, post)
        : await this.posts.insertLinked(tx, scope, productId, post);
      return toProductPost(row!);
    });
  }

  /** Accepts the assistant's suggestion; accepting a linked post changes nothing. */
  accept(scope: TenantScope, productId: string, id: string): Promise<ProductPost> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const row = await this.posts.find(tx, scope, productId, id);
      if (!row) throw productPostNotFound(id);
      if (row.status === 'linked') return toProductPost(row);
      await this.sellable(tx, scope, productId);
      const keys = row.aliasId ? [row.postId, row.aliasId] : [row.postId];
      const owner = (await this.posts.findByKeys(tx, scope, keys)).find(
        (other) => other.status === 'linked' && other.id !== row.id,
      );
      if (owner) throw productPostTaken(owner.productId, owner.productName);
      const accepted = await this.posts.relink(tx, scope, row.id, productId, row);
      return toProductPost(accepted!);
    });
  }

  remove(scope: TenantScope, productId: string, id: string): Promise<void> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.posts.delete(tx, scope, productId, id))) throw productPostNotFound(id);
    });
  }

  /** The Page's recent posts for the picker, each with the product it is linked to. */
  async pagePosts(scope: TenantScope): Promise<PagePostListResponse> {
    const graph = this.graph;
    if (!graph) throw messengerNotConfigured();
    const page = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.pages.findForMerchant(tx, scope),
    );
    if (!page) throw messengerPageNotConnected();
    const recent = await this.callGraph(() =>
      graph.listPagePosts(this.crypto.decrypt(page.accessToken), page.pageId),
    );
    const ids = recent.map((post) => idsOfGraphPost(post));
    const keys = ids.flatMap((entry) =>
      entry ? [entry.postId, entry.aliasId ?? entry.postId] : [],
    );
    const linked = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.posts.findByKeys(tx, scope, [...new Set(keys)]),
    );
    return {
      data: recent.map((post, index): PagePost => {
        const entry = ids[index];
        const row = entry
          ? linked.find(
              (candidate) =>
                candidate.status === 'linked' &&
                [candidate.postId, candidate.aliasId].some(
                  (key) => key === entry.postId || (key !== null && key === entry.aliasId),
                ),
            )
          : undefined;
        return {
          id: post.id,
          message: post.message,
          url: httpsLink(post.permalinkUrl),
          pictureUrl: post.pictureUrl,
          createdAt: isoOrNull(post.createdTime),
          linkedProduct: row ? { id: row.productId, name: row.productName } : null,
        };
      }),
    };
  }

  /** A pasted link: its ids, and its caption when Graph can read it (best effort). */
  private async fromUrl(scope: TenantScope, raw: string): Promise<PostDetails> {
    const url = allowedUrl(raw);
    let ref = url ? postRefOf(url) : null;
    if (ref?.kind === 'short') ref = await followShortLink(ref.url, this.fetchFn);
    if (ref?.kind !== 'post') throw productPostInvalidUrl();
    const known: PostDetails = {
      postId: ref.postId,
      aliasId: null,
      url: httpsLink(raw.trim()),
      caption: null,
    };
    const graph = this.graph;
    if (!graph) return known;
    const page = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.pages.findForMerchant(tx, scope),
    );
    const graphId = page ? graphPostId(ref, page.pageId) : null;
    if (!page || !graphId) return known;
    const read = await graph
      .getPost(this.crypto.decrypt(page.accessToken), graphId)
      .catch(() => null);
    return read ? merge(known, read) : known;
  }

  /** A post from the picker, read again from Graph so it is this Page's own. */
  private async fromPicker(scope: TenantScope, pagePostId: string): Promise<PostDetails> {
    const graph = this.graph;
    if (!graph) throw messengerNotConfigured();
    const page = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.pages.findForMerchant(tx, scope),
    );
    if (!page) throw messengerPageNotConnected();
    if (!pagePostId.startsWith(`${page.pageId}_`)) throw productPostInvalidUrl();
    const read = await this.callGraph(() =>
      graph.getPost(this.crypto.decrypt(page.accessToken), pagePostId),
    );
    const ids = read ? idsOfGraphPost(read) : null;
    if (!read || !ids) throw productPostInvalidUrl();
    return merge({ ...ids, url: null, caption: null }, read);
  }

  private async sellable(tx: Executor, scope: TenantScope, productId: string) {
    const product = await this.products.findProduct(tx, scope, productId);
    if (!product) throw productNotFound(productId);
    if (product.status === 'archived') throw productPostArchived(productId);
  }

  private async callGraph<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (isPermissionError(error)) throw facebookPermissionMissing(PAGE_OPTIONAL_SCOPES[0]);
      throw facebookUnavailable();
    }
  }
}

/** What Graph says about the post, over what the link said. */
function merge(known: PostDetails, read: GraphPost): PostDetails {
  const ids = idsOfGraphPost(read);
  const aliasOf = (id: string) => (id === known.postId ? null : id);
  return {
    postId: known.postId,
    aliasId:
      known.aliasId ??
      (ids ? (aliasOf(ids.postId) ?? (ids.aliasId ? aliasOf(ids.aliasId) : null)) : null),
    url: httpsLink(read.permalinkUrl) ?? known.url,
    caption: read.message ?? known.caption,
  };
}

function httpsLink(raw: string | null): string | null {
  const url = raw ? allowedUrl(raw) : null;
  if (!url) return null;
  url.protocol = 'https:';
  return url.toString();
}

function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function toProductPost(row: ProductPostRow): ProductPost {
  return {
    id: row.id,
    postId: row.postId,
    url: httpsLink(row.url),
    caption: row.caption,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
