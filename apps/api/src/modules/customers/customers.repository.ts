import { Injectable } from '@nestjs/common';
import {
  CUSTOMER_STATS_WINDOW_DAYS,
  INACTIVE_AFTER_DAYS,
  REPEAT_MIN_ORDERS,
  type CustomerFilter,
  type CustomerSort,
  type CustomerStatus,
  type OrderStatus,
  type SortDirection,
} from '@app/shared';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { likePattern } from '../database/like-pattern';
import {
  conversation,
  customer,
  order,
  orderItem,
  type ConversationRow,
  type CustomerRow,
  type OrderItemRow,
  type OrderRow,
} from '../database/schema/index';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Orders that never count towards a customer's figures. */
const UNSOLD: OrderStatus[] = ['cancelled', 'returned'];
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/** A customer with the figures the list and detail derive from orders and conversations. */
export interface CustomerStatsRow {
  customer: CustomerRow;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: Date | null;
  lastActiveAt: Date;
  status: CustomerStatus;
}

export interface CustomerListQuery {
  filter: CustomerFilter;
  q?: string;
  sort: CustomerSort;
  direction: SortDirection;
  offset: number;
  limit: number;
  now: Date;
}

export interface CustomerSummaryRow {
  all: number;
  needsYou: number;
  inactive: number;
  repeat: number;
  new: number;
  newInWindow: number;
  repeatCustomers: number;
  customersWithOrders: number;
  averageOrderValue: {
    allTime: number | null;
    currentWindow: number | null;
    previousWindow: number | null;
  };
}

export interface CustomerOrderRow {
  order: Pick<OrderRow, 'id' | 'number' | 'status' | 'total' | 'placedAt'>;
  items: Pick<OrderItemRow, 'productName' | 'variantName' | 'quantity'>[];
}

/** Splits a flat stats row back into the customer and its figures. */
function toStatsRow({
  orderCount,
  totalSpent,
  lastOrderAt,
  lastActiveAt,
  status,
  ...customerColumns
}: CustomerRow & Omit<CustomerStatsRow, 'customer'>): CustomerStatsRow {
  return { customer: customerColumns, orderCount, totalSpent, lastOrderAt, lastActiveAt, status };
}

const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value));
const toNullableNumber = (value: unknown) => (value === null ? null : Number(value));

/**
 * Read model for the Customers pages. Customer rows are written by the
 * Messenger ingest (conversations/customer.repository.ts); this side adds the
 * order and conversation aggregates and the seller's contact edits.
 */
@Injectable()
export class CustomersRepository {
  /**
   * Every customer of the merchant with their aggregates, as a subquery. The
   * status CASE is the one rule behind the badge, the tabs and their counts,
   * and mirrors the order documented on customerStatuses.
   */
  private statsQuery(executor: Executor, merchantId: string, now: Date) {
    const orderStats = executor
      .select({
        customerId: order.customerId,
        orderCount: sql<number>`count(*)`.mapWith(Number).as('order_count'),
        totalSpent: sql<number>`sum(${order.total})`.mapWith(Number).as('total_spent'),
        lastOrderAt: sql<Date>`max(${order.placedAt})`.mapWith(toDate).as('last_order_at'),
      })
      .from(order)
      .where(and(eq(order.merchantId, merchantId), notInArray(order.status, UNSOLD)))
      .groupBy(order.customerId)
      .as('order_stats');

    const conversationStats = executor
      .select({
        customerId: conversation.customerId,
        lastMessageAt: sql<Date>`max(${conversation.lastMessageAt})`
          .mapWith(toDate)
          .as('last_message_at'),
        needsYou: sql<boolean>`bool_or(${conversation.state} = 'handed_off')`.as('needs_you'),
      })
      .from(conversation)
      .where(eq(conversation.merchantId, merchantId))
      .groupBy(conversation.customerId)
      .as('conversation_stats');

    const orderCount = sql`coalesce(${orderStats.orderCount}, 0)`;
    // GREATEST ignores nulls, so a customer with no messages or orders falls back to first contact.
    const lastActiveAt = sql`greatest(${customer.createdAt}, ${conversationStats.lastMessageAt}, ${orderStats.lastOrderAt})`;
    const inactiveBefore = daysBefore(now, INACTIVE_AFTER_DAYS).toISOString();

    return executor
      .select({
        ...getTableColumns(customer),
        orderCount: sql<number>`${orderCount}`.mapWith(Number).as('c_order_count'),
        totalSpent: sql<number>`coalesce(${orderStats.totalSpent}, 0)`
          .mapWith(Number)
          .as('c_total_spent'),
        lastOrderAt: sql<Date | null>`${orderStats.lastOrderAt}`
          .mapWith(toDate)
          .as('c_last_order_at'),
        lastActiveAt: sql<Date>`${lastActiveAt}`.mapWith(toDate).as('c_last_active_at'),
        status: sql<CustomerStatus>`case
          when coalesce(${conversationStats.needsYou}, false) then 'needs_you'
          when ${lastActiveAt} < ${inactiveBefore}::timestamptz then 'inactive'
          when ${orderCount} >= ${REPEAT_MIN_ORDERS} then 'repeat'
          else 'new' end`.as('c_status'),
      })
      .from(customer)
      .leftJoin(orderStats, eq(orderStats.customerId, customer.id))
      .leftJoin(conversationStats, eq(conversationStats.customerId, customer.id))
      .where(eq(customer.merchantId, merchantId))
      .as('customer_stats');
  }

  async list(
    executor: Executor,
    { merchantId }: TenantScope,
    { filter, q, sort, direction, offset, limit, now }: CustomerListQuery,
  ): Promise<{ rows: CustomerStatsRow[]; total: number }> {
    const stats = this.statsQuery(executor, merchantId, now);
    const conditions: (SQL | undefined)[] = [
      filter === 'all' ? undefined : eq(stats.status, filter),
    ];
    if (q) {
      const pattern = likePattern(q);
      const digits = q.replace(/\D/g, '');
      conditions.push(
        or(
          ilike(stats.name, pattern),
          ilike(stats.area, pattern),
          ilike(stats.phone, pattern),
          // "01712345678" finds "01712-345678": compare digits only.
          digits.length >= 3
            ? sql`regexp_replace(${stats.phone}, '\\D', '', 'g') like ${likePattern(digits)}`
            : undefined,
        ),
      );
    }
    const where = and(...conditions);

    const key = {
      last_order: stats.lastOrderAt,
      orders: stats.orderCount,
      total_spent: stats.totalSpent,
    }[sort];
    const by = direction === 'asc' ? asc : desc;

    const rows = await executor
      .select()
      .from(stats)
      .where(where)
      // Customers without orders last, whichever the direction; id breaks ties.
      .orderBy(sql`${stats.orderCount} = 0`, by(key), by(stats.id))
      .limit(limit)
      .offset(offset);
    const [count] = await executor
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(stats)
      .where(where);
    return { rows: rows.map(toStatsRow), total: count?.total ?? 0 };
  }

  async findById(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    now: Date,
  ): Promise<CustomerStatsRow | null> {
    const stats = this.statsQuery(executor, merchantId, now);
    const [row] = await executor.select().from(stats).where(eq(stats.id, id));
    return row ? toStatsRow(row) : null;
  }

  async exists(executor: Executor, { merchantId }: TenantScope, id: string): Promise<boolean> {
    const rows = await executor
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.merchantId, merchantId), eq(customer.id, id)));
    return rows.length > 0;
  }

  /** Counts per status plus the stat cards. Counts and sums come back as strings and are converted here. */
  async summary(
    executor: Executor,
    { merchantId }: TenantScope,
    now: Date,
  ): Promise<CustomerSummaryRow> {
    const stats = this.statsQuery(executor, merchantId, now);
    const windowStart = daysBefore(now, CUSTOMER_STATS_WINDOW_DAYS).toISOString();
    const previousStart = daysBefore(now, 2 * CUSTOMER_STATS_WINDOW_DAYS).toISOString();
    const count = (condition: SQL) =>
      sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

    const [customers] = await executor
      .select({
        all: sql<number>`count(*)`.mapWith(Number),
        needsYou: count(sql`${stats.status} = 'needs_you'`),
        inactive: count(sql`${stats.status} = 'inactive'`),
        repeat: count(sql`${stats.status} = 'repeat'`),
        new: count(sql`${stats.status} = 'new'`),
        newInWindow: count(sql`${stats.createdAt} >= ${windowStart}::timestamptz`),
        repeatCustomers: count(sql`${stats.orderCount} >= ${REPEAT_MIN_ORDERS}`),
        customersWithOrders: count(sql`${stats.orderCount} > 0`),
      })
      .from(stats);
    const [orders] = await executor
      .select({
        allTime: sql`round(avg(${order.total}))`.mapWith(toNullableNumber),
        currentWindow:
          sql`round(avg(${order.total}) filter (where ${order.placedAt} >= ${windowStart}::timestamptz))`.mapWith(
            toNullableNumber,
          ),
        previousWindow:
          sql`round(avg(${order.total}) filter (where ${order.placedAt} >= ${previousStart}::timestamptz and ${order.placedAt} < ${windowStart}::timestamptz))`.mapWith(
            toNullableNumber,
          ),
      })
      .from(order)
      .where(and(eq(order.merchantId, merchantId), notInArray(order.status, UNSOLD)));
    return {
      all: customers?.all ?? 0,
      needsYou: customers?.needsYou ?? 0,
      inactive: customers?.inactive ?? 0,
      repeat: customers?.repeat ?? 0,
      new: customers?.new ?? 0,
      newInWindow: customers?.newInWindow ?? 0,
      repeatCustomers: customers?.repeatCustomers ?? 0,
      customersWithOrders: customers?.customersWithOrders ?? 0,
      averageOrderValue: {
        allTime: orders?.allTime ?? null,
        currentWindow: orders?.currentWindow ?? null,
        previousWindow: orders?.previousWindow ?? null,
      },
    };
  }

  /** The customer's most recently active conversation, across Pages. */
  async latestConversation(
    executor: Executor,
    { merchantId }: TenantScope,
    customerId: string,
  ): Promise<ConversationRow | null> {
    const [row] = await executor
      .select()
      .from(conversation)
      .where(and(eq(conversation.merchantId, merchantId), eq(conversation.customerId, customerId)))
      .orderBy(desc(conversation.lastMessageAt), desc(conversation.id))
      .limit(1);
    return row ?? null;
  }

  /** Newest first, cancelled included, each with its items in order. */
  async listOrders(
    executor: Executor,
    { merchantId }: TenantScope,
    customerId: string,
    { offset, limit }: { offset: number; limit: number },
  ): Promise<{ rows: CustomerOrderRow[]; total: number }> {
    const mine = and(eq(order.merchantId, merchantId), eq(order.customerId, customerId));
    const orders = await executor
      .select({
        id: order.id,
        number: order.number,
        status: order.status,
        total: order.total,
        placedAt: order.placedAt,
      })
      .from(order)
      .where(mine)
      .orderBy(desc(order.placedAt), desc(order.id))
      .limit(limit)
      .offset(offset);
    const [count] = await executor
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(order)
      .where(mine);

    const items =
      orders.length === 0
        ? []
        : await executor
            .select({
              orderId: orderItem.orderId,
              productName: orderItem.productName,
              variantName: orderItem.variantName,
              quantity: orderItem.quantity,
            })
            .from(orderItem)
            .where(
              and(
                eq(orderItem.merchantId, merchantId),
                inArray(
                  orderItem.orderId,
                  orders.map((row) => row.id),
                ),
              ),
            )
            .orderBy(asc(orderItem.orderId), asc(orderItem.position));

    const byOrder = new Map<string, CustomerOrderRow['items']>();
    for (const { orderId, ...item } of items) {
      byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), item]);
    }
    return {
      rows: orders.map((row) => ({ order: row, items: byOrder.get(row.id) ?? [] })),
      total: count?.total ?? 0,
    };
  }

  /** False when the merchant has no such customer. */
  async updateContact(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: Partial<Pick<CustomerRow, 'phone' | 'deliveryAddress' | 'area'>>,
  ): Promise<boolean> {
    if (Object.keys(values).length === 0) return this.exists(executor, { merchantId }, id);
    const rows = await executor
      .update(customer)
      .set(values)
      .where(and(eq(customer.merchantId, merchantId), eq(customer.id, id)))
      .returning({ id: customer.id });
    return rows.length > 0;
  }
}
