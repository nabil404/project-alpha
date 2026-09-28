import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../../database/base.repository';
import { one } from '../../../database/rows';
import { facebookPage, type FacebookPageRow } from '../../../database/schema/index';

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
}
