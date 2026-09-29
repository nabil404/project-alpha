import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { one } from '../../database/rows';
import { customer, type CustomerRow } from '../../database/schema/index';

/** The outcome of asking Facebook for a customer's profile; `name` is null when it shared none. */
export interface CustomerProfile {
  name: string | null;
  fetchedAt: Date;
}

@Injectable()
export class CustomerRepository {
  async findByPsid(
    executor: Executor,
    { merchantId }: TenantScope,
    psid: string,
  ): Promise<CustomerRow | null> {
    const [row] = await executor
      .select()
      .from(customer)
      .where(and(eq(customer.merchantId, merchantId), eq(customer.psid, psid)));
    return row ?? null;
  }

  /**
   * The customer for this PSID, created on first contact. A profile read
   * records the attempt and keeps any name already known; without one, the
   * conflict update is a no-op that still lets RETURNING yield the row.
   */
  async upsert(
    executor: Executor,
    { merchantId }: TenantScope,
    { psid, profile }: { psid: string; profile?: CustomerProfile },
  ): Promise<CustomerRow> {
    return one(
      await executor
        .insert(customer)
        .values({
          merchantId,
          psid,
          name: profile?.name ?? null,
          profileFetchedAt: profile?.fetchedAt ?? null,
        })
        .onConflictDoUpdate({
          target: [customer.merchantId, customer.psid],
          set: profile
            ? {
                name: sql`coalesce(excluded.name, ${customer.name})`,
                profileFetchedAt: sql`excluded.profile_fetched_at`,
              }
            : { psid: sql`excluded.psid` },
        })
        .returning(),
      'customer upsert',
    );
  }
}
