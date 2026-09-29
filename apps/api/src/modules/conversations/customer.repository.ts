import { Injectable } from '@nestjs/common';
import { and, asc, eq, exists, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import { conversation, customer, type CustomerRow } from '../database/schema/index';
import { PROFILE_REFRESH_MS, PROFILE_RETRY_MS } from './conversation-rules';

/** The outcome of asking Facebook for a customer's profile; a field is null when it shared none. */
export interface CustomerProfile {
  name: string | null;
  pictureUrl: string | null;
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
   * records the attempt and keeps any name or picture already known; without one, the
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
          pictureUrl: profile?.pictureUrl ?? null,
          profileFetchedAt: profile?.fetchedAt ?? null,
        })
        .onConflictDoUpdate({
          target: [customer.merchantId, customer.psid],
          set: profile
            ? {
                name: sql`coalesce(excluded.name, ${customer.name})`,
                pictureUrl: sql`coalesce(excluded.picture_url, ${customer.pictureUrl})`,
                profileFetchedAt: sql`excluded.profile_fetched_at`,
              }
            : { psid: sql`excluded.psid` },
        })
        .returning(),
      'customer upsert',
    );
  }

  /**
   * Customers due a profile read, by the same rule as needsProfile(), who
   * wrote or were written to since `activeSince`. Never-read customers come
   * first, then the longest since their last read.
   */
  async listStaleProfiles(
    executor: Executor,
    { merchantId }: TenantScope,
    { now, activeSince, limit }: { now: Date; activeSince: Date; limit: number },
  ): Promise<Pick<CustomerRow, 'id' | 'psid'>[]> {
    const retryBefore = new Date(now.getTime() - PROFILE_RETRY_MS);
    const refreshBefore = new Date(now.getTime() - PROFILE_REFRESH_MS);
    return executor
      .select({ id: customer.id, psid: customer.psid })
      .from(customer)
      .where(
        and(
          eq(customer.merchantId, merchantId),
          or(
            isNull(customer.profileFetchedAt),
            lte(customer.profileFetchedAt, refreshBefore),
            and(
              or(isNull(customer.name), isNull(customer.pictureUrl)),
              lte(customer.profileFetchedAt, retryBefore),
            ),
          ),
          exists(
            executor
              .select({ one: sql`1` })
              .from(conversation)
              .where(
                and(
                  eq(conversation.merchantId, merchantId),
                  eq(conversation.customerId, customer.id),
                  gte(conversation.lastMessageAt, activeSince),
                ),
              ),
          ),
        ),
      )
      .orderBy(sql`${customer.profileFetchedAt} asc nulls first`, asc(customer.id))
      .limit(limit);
  }

  /** Records a profile read, keeping any name or picture the read did not return. */
  async recordProfile(
    executor: Executor,
    { merchantId }: TenantScope,
    customerId: string,
    profile: CustomerProfile,
  ): Promise<boolean> {
    const rows = await executor
      .update(customer)
      .set({
        name: sql`coalesce(${profile.name}::text, ${customer.name})`,
        pictureUrl: sql`coalesce(${profile.pictureUrl}::text, ${customer.pictureUrl})`,
        profileFetchedAt: profile.fetchedAt,
      })
      .where(and(eq(customer.merchantId, merchantId), eq(customer.id, customerId)))
      .returning({ id: customer.id });
    return rows.length > 0;
  }
}
