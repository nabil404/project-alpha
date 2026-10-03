import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import { organization } from '../database/schema/index';

export interface ShopProfileRow {
  name: string;
  logo: string | null;
}

/**
 * The shop's name and logo, on Better Auth's organization row. The table has
 * no merchant_id and no policy - Better Auth reads it before any merchant
 * context exists - so the id filter here is the whole tenant boundary.
 */
@Injectable()
export class ShopProfileRepository {
  async find(executor: Executor, { merchantId }: TenantScope): Promise<ShopProfileRow> {
    const rows = await executor
      .select({ name: organization.name, logo: organization.logo })
      .from(organization)
      .where(eq(organization.id, merchantId));
    return one(rows, 'find organization');
  }

  async rename(executor: Executor, { merchantId }: TenantScope, name: string): Promise<void> {
    await executor.update(organization).set({ name }).where(eq(organization.id, merchantId));
  }

  /**
   * Sets the logo and returns the one it replaced. The row is locked first,
   * so of two concurrent uploads each learns exactly what it replaced and can
   * delete that object.
   */
  async swapLogo(
    executor: Executor,
    { merchantId }: TenantScope,
    logo: string | null,
  ): Promise<string | null> {
    const rows = await executor
      .select({ logo: organization.logo })
      .from(organization)
      .where(eq(organization.id, merchantId))
      .for('update');
    const previous = one(rows, 'swapLogo organization').logo;
    await executor.update(organization).set({ logo }).where(eq(organization.id, merchantId));
    return previous;
  }
}
