import { Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { conversation, customer, merchantSettings, message, order } from '../database/schema/index';

export interface DraftedOrder {
  id: string;
  reference: string;
  source: 'assistant' | 'seller';
  total: number;
  currency: string;
  customerName: string;
}

export interface WaitingConversation {
  id: string;
  state: (typeof conversation.$inferSelect)['state'];
  customerName: string | null;
}

export interface ShopRegion {
  timeZone: string;
  dateFormat: (typeof merchantSettings.$inferSelect)['dateFormat'];
  currency: string;
}

export interface DayTotals {
  orders: number;
  /** Minor units, leaving out cancelled and returned orders. */
  revenue: number;
}

/** What the notification emails say, read under the shop's merchant context. */
@Injectable()
export class NotificationReadsRepository {
  async draftedOrder(
    executor: Executor,
    { merchantId }: TenantScope,
    orderId: string,
  ): Promise<DraftedOrder | undefined> {
    const [row] = await executor
      .select({
        id: order.id,
        reference: order.reference,
        source: order.source,
        total: order.total,
        currency: order.currency,
        // The name as the order recorded it, not the customer's current one.
        customerName: order.customerName,
      })
      .from(order)
      .where(and(eq(order.merchantId, merchantId), eq(order.id, orderId)));
    return row;
  }

  async conversation(
    executor: Executor,
    { merchantId }: TenantScope,
    conversationId: string,
  ): Promise<WaitingConversation | undefined> {
    const [row] = await executor
      .select({ id: conversation.id, state: conversation.state, customerName: customer.name })
      .from(conversation)
      .innerJoin(
        customer,
        and(
          eq(customer.merchantId, conversation.merchantId),
          eq(customer.id, conversation.customerId),
        ),
      )
      .where(and(eq(conversation.merchantId, merchantId), eq(conversation.id, conversationId)));
    return row;
  }

  /** Whether the seller has written in the conversation since `since`, from here or Facebook's inbox. */
  async sellerRepliedSince(
    executor: Executor,
    { merchantId }: TenantScope,
    conversationId: string,
    since: Date,
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.merchantId, merchantId),
          eq(message.conversationId, conversationId),
          eq(message.sender, 'seller'),
          gte(message.sentAt, since),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** The shop's settings row, or undefined if it has never saved one (it reads as the default region). */
  async region(executor: Executor, { merchantId }: TenantScope): Promise<ShopRegion | undefined> {
    const [row] = await executor
      .select({
        timeZone: merchantSettings.timeZone,
        dateFormat: merchantSettings.dateFormat,
        currency: merchantSettings.currency,
      })
      .from(merchantSettings)
      .where(eq(merchantSettings.merchantId, merchantId));
    return row;
  }

  /** Orders placed on the shop-local `day` (yyyy-MM-dd) in `timeZone`, the boundaries computed by Postgres. */
  async dayTotals(
    executor: Executor,
    { merchantId }: TenantScope,
    day: string,
    timeZone: string,
  ): Promise<DayTotals> {
    const start = sql`(${day}::date)::timestamp at time zone ${timeZone}`;
    const end = sql`(${day}::date + 1)::timestamp at time zone ${timeZone}`;
    const [row] = await executor
      .select({
        orders: sql<number>`count(*)`.mapWith(Number),
        revenue:
          sql<number>`coalesce(sum(${order.total}) filter (where ${order.status} not in ('cancelled', 'returned')), 0)`.mapWith(
            Number,
          ),
      })
      .from(order)
      .where(
        and(
          eq(order.merchantId, merchantId),
          sql`${order.placedAt} >= ${start}`,
          sql`${order.placedAt} < ${end}`,
        ),
      );
    return { orders: row?.orders ?? 0, revenue: row?.revenue ?? 0 };
  }
}
