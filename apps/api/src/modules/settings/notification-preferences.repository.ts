import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_DEFAULTS,
  type NotificationKind,
  type NotificationSettings,
  type UpdateNotificationSettings,
} from '@app/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { member, notificationPreference, user } from '../database/schema/index';

/** Who gets an email: a member of the shop with the switch on and a verified address. */
export interface NotificationRecipient {
  userId: string;
  email: string;
}

const switches = {
  newOrder: notificationPreference.newOrder,
  customerWaiting: notificationPreference.customerWaiting,
  dailySummary: notificationPreference.dailySummary,
} as const;

/**
 * One person's switches for one shop. The user id comes from the session,
 * like the merchant; a person with no row reads as NOTIFICATION_DEFAULTS.
 */
@Injectable()
export class NotificationPreferencesRepository {
  async find(
    executor: Executor,
    { merchantId }: TenantScope,
    userId: string,
  ): Promise<NotificationSettings | undefined> {
    const [row] = await executor
      .select(switches)
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.merchantId, merchantId),
          eq(notificationPreference.userId, userId),
        ),
      );
    return row;
  }

  /** Writes the switches sent; a first write fills the rest from the defaults. */
  async upsert(
    executor: Executor,
    { merchantId }: TenantScope,
    userId: string,
    changes: UpdateNotificationSettings,
  ): Promise<NotificationSettings> {
    const [row] = await executor
      .insert(notificationPreference)
      .values({ merchantId, userId, ...NOTIFICATION_DEFAULTS, ...changes })
      .onConflictDoUpdate({
        target: [notificationPreference.merchantId, notificationPreference.userId],
        set: { ...changes, updatedAt: new Date() },
      })
      .returning(switches);
    if (!row) throw new Error('upsert notification_preference returned no row');
    return row;
  }

  /**
   * The shop's members who want `kind`: a member with no row gets the default.
   * Only verified addresses, so an email never goes to an unconfirmed one.
   */
  async recipients(
    executor: Executor,
    { merchantId }: TenantScope,
    kind: NotificationKind,
  ): Promise<NotificationRecipient[]> {
    const wants = sql<boolean>`coalesce(${switches[kind]}, ${NOTIFICATION_DEFAULTS[kind]})`;
    return executor
      .select({ userId: user.id, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .leftJoin(
        notificationPreference,
        and(
          eq(notificationPreference.merchantId, member.organizationId),
          eq(notificationPreference.userId, member.userId),
        ),
      )
      .where(and(eq(member.organizationId, merchantId), eq(user.emailVerified, true), wants))
      .orderBy(user.id);
  }
}
