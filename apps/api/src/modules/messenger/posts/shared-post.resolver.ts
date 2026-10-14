import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto.service';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import type { SharedLink } from '../../queue/queue.constants';
import { META_GRAPH } from '../page/facebook-page.tokens';
import type { GraphPost, MetaGraphClient } from '../page/meta-graph.client';
import {
  allowedUrl,
  followShortLink,
  graphPostId,
  idsOfGraphPost,
  postRefOf,
  postRefOfId,
  type PostRef,
} from './post-links';
import { ProductPostRepository, type PostDetails } from './product-post.repository';

/** fetch for the one redirect hop of a short link; a provider so specs can stub it. */
export const POST_LINK_FETCH = Symbol('POST_LINK_FETCH');

/**
 * What a shared post or link names, most exact first: a product by our own
 * link or a post the seller linked (`product`); a product only suggested
 * before (`suggested`); a post whose caption Facebook gave us (`caption`);
 * or nothing we can read (`unknown`).
 */
export type ShareResolution =
  | { kind: 'product'; productId: string }
  | { kind: 'suggested'; productId: string; post: PostDetails }
  | { kind: 'caption'; caption: string; post: PostDetails }
  | { kind: 'unknown' };

type PostIdRef = Extract<PostRef, { kind: 'post' }>;

/**
 * Resolves a customer's shared links for the assistant turn. Short links are
 * followed one hop and the caption read from Graph with no transaction open;
 * the lookup is its own short read. Never throws for a link or Graph failure:
 * that is an `unknown` share, which the turn answers by asking.
 */
@Injectable()
export class SharedPostResolver {
  private readonly logger = new Logger(SharedPostResolver.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly posts: ProductPostRepository,
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
    @Inject(POST_LINK_FETCH) private readonly fetchFn: typeof fetch,
  ) {}

  async resolve(
    scope: TenantScope,
    links: readonly SharedLink[],
    page: { pageId: string; accessToken: string },
  ): Promise<ShareResolution> {
    const found = await this.refsOf(links);
    const product = found.find((entry) => entry.ref.kind === 'product')?.ref;
    if (product?.kind === 'product') return { kind: 'product', productId: product.productId };

    const posts = mergeIds(found);
    if (posts.length === 0) return { kind: 'unknown' };
    const keys = posts.flatMap((post) => post.keys);
    const matched = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.posts.findByKeys(tx, scope, keys),
    );
    const linked = matched.find((row) => row.status === 'linked');
    if (linked) return { kind: 'product', productId: linked.productId };

    // A share often names the post only by its pfbid id, and Graph links it by
    // its number: read it, and match again on the number Graph gives back.
    const first = posts[0]!;
    const read = await this.read(first.ref, page);
    const ids = read ? idsOfGraphPost(read) : null;
    const post: PostDetails = {
      postId: ids?.postId ?? first.ref.postId,
      aliasId:
        [ids?.aliasId, ...first.keys].find(
          (key) => key && key !== (ids?.postId ?? first.ref.postId),
        ) ?? null,
      url: read?.permalinkUrl && allowedUrl(read.permalinkUrl) ? read.permalinkUrl : first.url,
      caption: read?.message?.trim() || null,
    };
    if (ids && !keys.includes(ids.postId)) {
      const learned = await withMerchant(this.db, scope.merchantId, async (tx) => {
        const rows = await this.posts.findByKeys(tx, scope, [ids.postId]);
        const row = rows.find((candidate) => candidate.status === 'linked') ?? rows[0];
        // So the next share of this post matches without asking Graph.
        if (row && post.aliasId) await this.posts.learnAlias(tx, scope, row.id, post.aliasId);
        return rows;
      });
      const now = learned.find((row) => row.status === 'linked');
      if (now) return { kind: 'product', productId: now.productId };
      matched.push(...learned);
    }

    const suggested = matched[0];
    if (suggested) return { kind: 'suggested', productId: suggested.productId, post };
    return post.caption ? { kind: 'caption', caption: post.caption, post } : { kind: 'unknown' };
  }

  /** The post from Graph by its Page-scoped id; null when Graph cannot or will not read it. */
  private async read(
    ref: PostIdRef,
    page: { pageId: string; accessToken: string },
  ): Promise<GraphPost | null> {
    const graphId = graphPostId(ref, page.pageId);
    if (!graphId || !this.graph) return null;
    try {
      return await this.graph.getPost(this.crypto.decrypt(page.accessToken), graphId);
    } catch (error) {
      this.logger.warn(
        `Shared post not read: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  /** Each link's references, short links followed one hop. */
  private async refsOf(links: readonly SharedLink[]): Promise<Found[]> {
    const found: Found[] = [];
    for (const [link, { postId, url: raw }] of links.entries()) {
      const byId = postRefOfId(postId);
      if (byId) found.push({ link, url: raw, ref: byId });
      const url = raw ? allowedUrl(raw) : null;
      let byUrl = url ? postRefOf(url) : null;
      if (byUrl?.kind === 'short') byUrl = await followShortLink(byUrl.url, this.fetchFn);
      if (byUrl) found.push({ link, url: raw, ref: byUrl });
    }
    return found;
  }
}

/** A reference read from the shared link at index `link`; never a short link. */
interface Found {
  link: number;
  url: string | null;
  ref: PostRef;
}

/** One entry per shared link naming a post, with every id its attachment and its link gave. */
function mergeIds(found: Found[]): { ref: PostIdRef; keys: string[]; url: string | null }[] {
  const byLink = new Map<number, { ref: PostIdRef; keys: string[]; url: string | null }>();
  for (const { link, url, ref } of found) {
    if (ref.kind !== 'post') continue;
    const entry = byLink.get(link);
    if (!entry) {
      byLink.set(link, { ref, keys: [ref.postId], url });
      continue;
    }
    if (!entry.keys.includes(ref.postId)) entry.keys.push(ref.postId);
    // A numeric id is the one Graph can read.
    if (!/^\d+$/.test(entry.ref.postId) && /^\d+$/.test(ref.postId)) entry.ref = ref;
  }
  return [...byLink.values()];
}
