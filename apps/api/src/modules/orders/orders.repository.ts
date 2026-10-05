import { Injectable } from '@nestjs/common';
import {
  ORDER_STATS_WINDOW_DAYS,
  orderStatuses,
  type OrderFilter,
  type OrderSort,
  type OrderStatus,
  type SortDirection,
} from '@app/shared';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { likePattern } from '../database/like-pattern';
import { one } from '../database/rows';
import {
  customer,
  order,
  orderItem,
  type OrderItemRow,
  type OrderRow,
} from '../database/schema/index';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/** Orders that never count towards revenue or a customer's spend. */
const NOT_SOLD: OrderStatus[] = ['cancelled', 'returned'];

/** "481" or "#481": that number in any year. */
const BARE_NUMBER_PATTERN = /^#?0*(\d{1,9})$/;
/** "ORD-2026-00481", also unpadded or without dashes: that year's number. */
const REFERENCE_PATTERN = /^#?ORD-?(\d{4})-?0*(\d{1,9})$/i;

export interface OrderSearch {
  q?: string;
  /** Inclusive. */
  from?: string;
  /** Exclusive. */
  to?: string;
}

export interface OrderListQuery extends OrderSearch {
  status: OrderFilter;
  sort: OrderSort;
  direction: SortDirection;
  offset: number;
  limit: number;
}

export type OrderLineSummary = Pick<OrderItemRow, 'productName' | 'variantName' | 'quantity'>;

export interface OrderListRow {
  order: OrderRow;
  firstItem: OrderLineSummary;
  itemCount: number;
}

export interface OrderCards {
  awaitingConfirmation: number;
  confirmed: number;
  packed: number;
  revenueCurrent: number;
  revenuePrevious: number;
  placedInWindow: number;
  byAssistantInWindow: number;
}

export type NewOrderValues = Omit<
  typeof order.$inferInsert,
  'id' | 'merchantId' | 'revision' | 'createdAt' | 'updatedAt'
>;
export type OrderChanges = Partial<
  Pick<
    OrderRow,
    | 'status'
    | 'paymentStatus'
    | 'paymentMethod'
    | 'subtotal'
    | 'deliveryCharge'
    | 'total'
    | 'customerName'
    | 'phone'
    | 'deliveryAddress'
    | 'deliveryZone'
    | 'trackingNumber'
    | 'notes'
  >
>;
export type NewOrderLine = Omit<
  typeof orderItem.$inferInsert,
  'id' | 'merchantId' | 'orderId' | 'position' | 'createdAt'
>;

export interface OrderCustomer {
  id: string;
  name: string | null;
  pictureUrl: string | null;
  phone: string | null;
  deliveryAddress: string | null;
}

@Injectable()
export class OrdersRepository {
  /** The search and date filters the list and its tab counts share. */
  private searchConditions(merchantId: string, { q, from, to }: OrderSearch): SQL | undefined {
    const conditions: (SQL | undefined)[] = [eq(order.merchantId, merchantId)];
    if (from) conditions.push(gte(order.placedAt, new Date(from)));
    if (to) conditions.push(lt(order.placedAt, new Date(to)));
    if (q) {
      const digits = q.replace(/\D/g, '');
      const bare = BARE_NUMBER_PATTERN.exec(q)?.[1];
      const reference = REFERENCE_PATTERN.exec(q);
      conditions.push(
        or(
          bare ? eq(order.number, Number(bare)) : undefined,
          reference
            ? and(eq(order.year, Number(reference[1])), eq(order.number, Number(reference[2])))
            : undefined,
          // Part of a reference ("ORD-2026", "2026-004"). Digits alone match
          // the number exactly instead, or "481" would find 01481 too.
          bare ? undefined : ilike(order.reference, likePattern(q)),
          ilike(order.customerName, likePattern(q)),
          ilike(order.phone, likePattern(q)),
          // "01712345678" finds "01712-345678": compare digits only.
          digits.length >= 3
            ? sql`regexp_replace(${order.phone}, '\\D', '', 'g') like ${likePattern(digits)}`
            : undefined,
        ),
      );
    }
    return and(...conditions);
  }

  async list(
    executor: Executor,
    { merchantId }: TenantScope,
    { status, sort, direction, offset, limit, ...search }: OrderListQuery,
  ): Promise<{ rows: OrderListRow[]; total: number }> {
    const where = and(
      this.searchConditions(merchantId, search),
      status === 'all' ? undefined : eq(order.status, status),
    );
    const by = direction === 'asc' ? asc : desc;
    const key = sort === 'total' ? order.total : order.placedAt;

    const orders = await executor
      .select()
      .from(order)
      .where(where)
      .orderBy(by(key), by(order.id))
      .limit(limit)
      .offset(offset);
    const [count] = await executor
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(order)
      .where(where);

    const lines = await this.lineSummaries(
      executor,
      merchantId,
      orders.map((row) => row.id),
    );
    const rows = orders.flatMap((row) => {
      const items = lines.get(row.id);
      // Every order is written with at least one line; one without is skipped, not crashed on.
      return items?.[0] ? [{ order: row, firstItem: items[0], itemCount: items.length }] : [];
    });
    return { rows, total: count?.total ?? 0 };
  }

  private async lineSummaries(
    executor: Executor,
    merchantId: string,
    orderIds: string[],
  ): Promise<Map<string, OrderLineSummary[]>> {
    if (orderIds.length === 0) return new Map();
    const items = await executor
      .select({
        orderId: orderItem.orderId,
        productName: orderItem.productName,
        variantName: orderItem.variantName,
        quantity: orderItem.quantity,
      })
      .from(orderItem)
      .where(and(eq(orderItem.merchantId, merchantId), inArray(orderItem.orderId, orderIds)))
      .orderBy(asc(orderItem.orderId), asc(orderItem.position));
    const byOrder = new Map<string, OrderLineSummary[]>();
    for (const { orderId, ...item } of items) {
      byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), item]);
    }
    return byOrder;
  }

  /** Orders per status under the search and dates, plus `all`. */
  async countByStatus(
    executor: Executor,
    { merchantId }: TenantScope,
    search: OrderSearch,
  ): Promise<Record<OrderStatus | 'all', number>> {
    const rows = await executor
      .select({ status: order.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(order)
      .where(this.searchConditions(merchantId, search))
      .groupBy(order.status);
    const counts = Object.fromEntries(orderStatuses.map((status) => [status, 0])) as Record<
      OrderStatus,
      number
    >;
    let all = 0;
    for (const row of rows) {
      counts[row.status] = row.count;
      all += row.count;
    }
    return { all, ...counts };
  }

  /** The stat cards, over fixed windows ending `now`. Sums come back as strings and are converted here. */
  async cards(executor: Executor, { merchantId }: TenantScope, now: Date): Promise<OrderCards> {
    const windowStart = daysBefore(now, ORDER_STATS_WINDOW_DAYS).toISOString();
    const previousStart = daysBefore(now, 2 * ORDER_STATS_WINDOW_DAYS).toISOString();
    const inWindow = sql`${order.placedAt} >= ${windowStart}::timestamptz`;
    const inPrevious = sql`${order.placedAt} >= ${previousStart}::timestamptz and ${order.placedAt} < ${windowStart}::timestamptz`;
    const sold = sql`${order.status} not in ('cancelled', 'returned')`;
    const count = (condition: SQL) =>
      sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
    const sum = (condition: SQL) =>
      sql<number>`coalesce(sum(${order.total}) filter (where ${condition}), 0)`.mapWith(Number);

    const [row] = await executor
      .select({
        awaitingConfirmation: count(sql`${order.status} = 'new'`),
        confirmed: count(sql`${order.status} = 'confirmed'`),
        packed: count(sql`${order.status} = 'packed'`),
        revenueCurrent: sum(sql`${sold} and ${inWindow}`),
        revenuePrevious: sum(sql`${sold} and ${inPrevious}`),
        placedInWindow: count(inWindow),
        byAssistantInWindow: count(sql`${inWindow} and ${order.source} = 'assistant'`),
      })
      .from(order)
      .where(eq(order.merchantId, merchantId));
    return {
      awaitingConfirmation: row?.awaitingConfirmation ?? 0,
      confirmed: row?.confirmed ?? 0,
      packed: row?.packed ?? 0,
      revenueCurrent: row?.revenueCurrent ?? 0,
      revenuePrevious: row?.revenuePrevious ?? 0,
      placedInWindow: row?.placedInWindow ?? 0,
      byAssistantInWindow: row?.byAssistantInWindow ?? 0,
    };
  }

  async find(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<OrderRow | undefined> {
    const query = executor
      .select()
      .from(order)
      .where(and(eq(order.merchantId, merchantId), eq(order.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  async findByIdempotencyKey(
    executor: Executor,
    { merchantId }: TenantScope,
    key: string,
  ): Promise<OrderRow | undefined> {
    const [row] = await executor
      .select()
      .from(order)
      .where(and(eq(order.merchantId, merchantId), eq(order.idempotencyKey, key)));
    return row;
  }

  async items(
    executor: Executor,
    { merchantId }: TenantScope,
    orderId: string,
  ): Promise<OrderItemRow[]> {
    return executor
      .select()
      .from(orderItem)
      .where(and(eq(orderItem.merchantId, merchantId), eq(orderItem.orderId, orderId)))
      .orderBy(asc(orderItem.position));
  }

  async findCustomer(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<OrderCustomer | undefined> {
    const [row] = await executor
      .select({
        id: customer.id,
        name: customer.name,
        pictureUrl: customer.pictureUrl,
        phone: customer.phone,
        deliveryAddress: customer.deliveryAddress,
      })
      .from(customer)
      .where(and(eq(customer.merchantId, merchantId), eq(customer.id, id)));
    return row;
  }

  /** The customer's orders placed before `before`, leaving out `excludeId` and ones never sold. */
  async customerHistory(
    executor: Executor,
    { merchantId }: TenantScope,
    customerId: string,
    { before, excludeId }: { before: Date; excludeId: string },
  ): Promise<{ count: number; spent: number }> {
    const [row] = await executor
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        spent: sql<number>`coalesce(sum(${order.total}), 0)`.mapWith(Number),
      })
      .from(order)
      .where(
        and(
          eq(order.merchantId, merchantId),
          eq(order.customerId, customerId),
          lt(order.placedAt, before),
          sql`${order.id} <> ${excludeId}`,
          notInArray(order.status, NOT_SOLD),
        ),
      );
    return { count: row?.count ?? 0, spent: row?.spent ?? 0 };
  }

  /**
   * The shop's next order number in `year`; the first order of a year is 1.
   * Only race-free while the caller holds the shop's settings row lock, which
   * every order creation takes first. Reads the end of the
   * (merchant_id, year, number) unique index, however many orders there are.
   */
  async nextNumber(executor: Executor, { merchantId }: TenantScope, year: number): Promise<number> {
    const [row] = await executor
      .select({ last: sql<number>`coalesce(max(${order.number}), 0)`.mapWith(Number) })
      .from(order)
      .where(and(eq(order.merchantId, merchantId), eq(order.year, year)));
    return (row?.last ?? 0) + 1;
  }

  async insert(
    executor: Executor,
    { merchantId }: TenantScope,
    values: NewOrderValues,
  ): Promise<OrderRow> {
    const rows = await executor
      .insert(order)
      .values({ merchantId, ...values })
      .returning();
    return one(rows, 'insert order');
  }

  /** Replaces every line, in the given order. */
  async replaceItems(
    executor: Executor,
    { merchantId }: TenantScope,
    orderId: string,
    lines: NewOrderLine[],
  ): Promise<void> {
    await executor
      .delete(orderItem)
      .where(and(eq(orderItem.merchantId, merchantId), eq(orderItem.orderId, orderId)));
    await executor
      .insert(orderItem)
      .values(lines.map((line, position) => ({ merchantId, orderId, position, ...line })));
  }

  /** Writes the changes and bumps `revision`, even with none, so every write is a new version. */
  async update(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    changes: OrderChanges,
  ): Promise<OrderRow> {
    const rows = await executor
      .update(order)
      .set({ ...changes, revision: sql`${order.revision} + 1` })
      .where(and(eq(order.merchantId, merchantId), eq(order.id, id)))
      .returning();
    return one(rows, 'update order');
  }
}
