import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { one } from '../../database/rows';
import { facebookPage, type FacebookPageRow } from '../../database/schema/index';

/** Our code for a failed Messenger Profile sync, never Graph's text. */
export type ProfileSyncError = 'token_invalid' | 'graph_error';

export interface PageValues {
  pageId: string;
  name: string;
  /** CryptoService ciphertext, never the token itself. */
  accessToken: string;
}

/** Rows only. Facebook is the service's business, and never called from here. */
@Injectable()
export class FacebookPageRepository {
  /** The shop's Page, if it has one. `lock` serializes connect and disconnect. */
  async findForMerchant(
    executor: Executor,
    { merchantId }: TenantScope,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<FacebookPageRow | null> {
    const query = executor
      .select()
      .from(facebookPage)
      .where(eq(facebookPage.merchantId, merchantId));
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  async insert(
    executor: Executor,
    { merchantId }: TenantScope,
    values: PageValues,
  ): Promise<FacebookPageRow> {
    return one(
      await executor
        .insert(facebookPage)
        .values({ ...values, merchantId })
        .returning(),
      'facebook page insert',
    );
  }

  /** Refreshes the name and token of the Page the shop already has. */
  async update(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: Omit<PageValues, 'pageId'>,
  ): Promise<FacebookPageRow> {
    return one(
      await executor
        .update(facebookPage)
        .set(values)
        .where(and(eq(facebookPage.merchantId, merchantId), eq(facebookPage.id, id)))
        .returning(),
      'facebook page update',
    );
  }

  /** Deletes the shop's Page and returns it, or null when it had none. */
  async deleteForMerchant(
    executor: Executor,
    { merchantId }: TenantScope,
  ): Promise<FacebookPageRow | null> {
    const [row] = await executor
      .delete(facebookPage)
      .where(eq(facebookPage.merchantId, merchantId))
      .returning();
    return row ?? null;
  }

  /** A sync was asked for. Clears the last error, so a fresh request never reads as failed. */
  async markProfileRequested(
    executor: Executor,
    { merchantId }: TenantScope,
    at: Date,
  ): Promise<void> {
    await executor
      .update(facebookPage)
      .set({ profileSyncRequestedAt: at, profileSyncError: null })
      .where(eq(facebookPage.merchantId, merchantId));
  }

  async markProfileSynced(
    executor: Executor,
    { merchantId }: TenantScope,
    at: Date,
  ): Promise<void> {
    await executor
      .update(facebookPage)
      .set({ profileSyncedAt: at, profileSyncError: null })
      .where(eq(facebookPage.merchantId, merchantId));
  }

  /** Keeps `profileSyncedAt`: the Page still shows the profile Meta last accepted. */
  async markProfileFailed(
    executor: Executor,
    { merchantId }: TenantScope,
    error: ProfileSyncError,
    at: Date,
  ): Promise<void> {
    await executor
      .update(facebookPage)
      .set({ profileSyncError: error, updatedAt: at })
      .where(eq(facebookPage.merchantId, merchantId));
  }

  /**
   * Every shop with a connected Page, for worker jobs that run without a
   * merchant context. facebook_page is under forced RLS, so this goes through
   * the app_connected_merchants() SECURITY DEFINER function (migration 0040),
   * which returns merchant ids only.
   */
  async listConnectedMerchantIds(executor: Executor): Promise<string[]> {
    const result = await executor.execute<{ merchant_id: string }>(
      sql`select merchant_id from app_connected_merchants() as merchant_id`,
    );
    return result.rows.map((row) => row.merchant_id);
  }
}
