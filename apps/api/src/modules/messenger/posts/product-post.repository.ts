import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { product, productPost, type ProductPostRow } from '../../database/schema/index';

/** A post as one of its ids names it, with the other id when we know it. */
export interface PostIds {
  postId: string;
  aliasId: string | null;
}

export interface PostDetails extends PostIds {
  url: string | null;
  caption: string | null;
}

export interface MatchedPost extends ProductPostRow {
  productName: string;
}

/** Posts linked or suggested for products. Every method is scoped to one shop. */
@Injectable()
export class ProductPostRepository {
  listForProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
  ): Promise<ProductPostRow[]> {
    return executor
      .select()
      .from(productPost)
      .where(and(eq(productPost.merchantId, merchantId), eq(productPost.productId, productId)))
      .orderBy(desc(productPost.createdAt), productPost.id);
  }

  async find(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    id: string,
  ): Promise<ProductPostRow | null> {
    const [row] = await executor
      .select()
      .from(productPost)
      .where(
        and(
          eq(productPost.merchantId, merchantId),
          eq(productPost.productId, productId),
          eq(productPost.id, id),
        ),
      );
    return row ?? null;
  }

  /** Rows whose post or alias id is any of `keys`, linked ones first. */
  async findByKeys(
    executor: Executor,
    { merchantId }: TenantScope,
    keys: readonly string[],
  ): Promise<MatchedPost[]> {
    if (keys.length === 0) return [];
    const rows = await executor
      .select({ row: productPost, productName: product.name })
      .from(productPost)
      .innerJoin(
        product,
        and(eq(product.merchantId, productPost.merchantId), eq(product.id, productPost.productId)),
      )
      .where(
        and(
          eq(productPost.merchantId, merchantId),
          or(inArray(productPost.postId, [...keys]), inArray(productPost.aliasId, [...keys])),
        ),
      )
      .orderBy(sql`${productPost.status} = 'linked' desc`, productPost.createdAt);
    return rows.map(({ row, productName }) => ({ ...row, productName }));
  }

  /** A new linked row; the caller has checked no row holds the post. */
  async insertLinked(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    post: PostDetails,
  ): Promise<ProductPostRow> {
    const [row] = await executor
      .insert(productPost)
      .values({ merchantId, productId, ...post, status: 'linked' })
      .returning();
    return row!;
  }

  /** Turns the row into a link to `productId`, keeping any id or text it had. */
  async relink(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    productId: string,
    post: PostDetails,
  ): Promise<ProductPostRow | null> {
    const [row] = await executor
      .update(productPost)
      .set({
        productId,
        status: 'linked',
        aliasId: sql`coalesce(${productPost.aliasId}, ${post.aliasId})`,
        url: sql`coalesce(${post.url}, ${productPost.url})`,
        caption: sql`coalesce(${post.caption}, ${productPost.caption})`,
        updatedAt: new Date(),
      })
      .where(and(eq(productPost.merchantId, merchantId), eq(productPost.id, id)))
      .returning();
    return row ?? null;
  }

  /** Records the post's other id on a row that has none yet. */
  async learnAlias(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    aliasId: string,
  ): Promise<void> {
    await executor
      .update(productPost)
      .set({ aliasId, updatedAt: new Date() })
      .where(
        and(
          eq(productPost.merchantId, merchantId),
          eq(productPost.id, id),
          isNull(productPost.aliasId),
          ne(productPost.postId, aliasId),
        ),
      );
  }

  /** The assistant's guess; a post with a row already, linked or suggested, keeps it. */
  async suggest(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    post: PostDetails,
  ): Promise<boolean> {
    const rows = await executor
      .insert(productPost)
      .values({ merchantId, productId, ...post, status: 'suggested' })
      .onConflictDoNothing({ target: [productPost.merchantId, productPost.postId] })
      .returning({ id: productPost.id });
    return rows.length > 0;
  }

  async delete(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    id: string,
  ): Promise<boolean> {
    const rows = await executor
      .delete(productPost)
      .where(
        and(
          eq(productPost.merchantId, merchantId),
          eq(productPost.productId, productId),
          eq(productPost.id, id),
        ),
      )
      .returning({ id: productPost.id });
    return rows.length > 0;
  }
}
