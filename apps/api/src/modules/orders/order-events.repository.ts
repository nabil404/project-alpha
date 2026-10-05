import { Injectable } from '@nestjs/common';
import type { OrderEventData } from '@app/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { orderEvent, user, type OrderEventRow } from '../database/schema/index';

export interface OrderEventWithActor {
  event: OrderEventRow;
  actor: { id: string; name: string } | null;
}

@Injectable()
export class OrderEventsRepository {
  /** Newest first. An order gathers a handful of events, so the list is not paginated. */
  async list(
    executor: Executor,
    { merchantId }: TenantScope,
    orderId: string,
  ): Promise<OrderEventWithActor[]> {
    return executor
      .select({ event: orderEvent, actor: { id: user.id, name: user.name } })
      .from(orderEvent)
      .leftJoin(user, eq(user.id, orderEvent.actorId))
      .where(and(eq(orderEvent.merchantId, merchantId), eq(orderEvent.orderId, orderId)))
      .orderBy(desc(orderEvent.createdAt), desc(orderEvent.id));
  }

  /** `actorId` is the seller who did it; null for the assistant. */
  async insert(
    executor: Executor,
    { merchantId }: TenantScope,
    orderId: string,
    actorId: string | null,
    events: OrderEventData[],
  ): Promise<void> {
    if (events.length === 0) return;
    await executor
      .insert(orderEvent)
      .values(events.map((data) => ({ merchantId, orderId, actorId, type: data.type, data })));
  }
}
