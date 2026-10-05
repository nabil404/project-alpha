import {
  nextOrderStatuses,
  orderEventDataSchema,
  type OrderDetail,
  type OrderEvent,
  type OrderListItem,
} from '@app/shared';
import type { OrderItemRow, OrderRow } from '../database/schema/index';
import type { OrderEventWithActor } from './order-events.repository';
import type { OrderCustomer, OrderListRow } from './orders.repository';

export const orderVersion = (row: Pick<OrderRow, 'revision'>) => String(row.revision);

export function toOrderListItem({ order, firstItem, itemCount }: OrderListRow): OrderListItem {
  return {
    id: order.id,
    reference: order.reference,
    number: order.number,
    year: order.year,
    source: order.source,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    customer: { id: order.customerId, name: order.customerName, phone: order.phone },
    firstItem,
    itemCount,
    total: order.total,
    currency: order.currency,
    placedAt: order.placedAt.toISOString(),
  };
}

export interface OrderDetailParts {
  order: OrderRow;
  items: OrderItemRow[];
  customer: OrderCustomer;
  history: { count: number; spent: number };
}

export function toOrderDetail({ order, items, customer, history }: OrderDetailParts): OrderDetail {
  return {
    id: order.id,
    reference: order.reference,
    number: order.number,
    year: order.year,
    version: orderVersion(order),
    source: order.source,
    status: order.status,
    nextStatuses: [...nextOrderStatuses(order.status)],
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    subtotal: order.subtotal,
    // wire renamed in Task 7
    deliveryCharge: order.deliveryFee,
    total: order.total,
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.quantity * item.unitPrice,
    })),
    delivery: {
      name: order.customerName,
      phone: order.phone,
      address: order.deliveryAddress,
      // wire renamed in Task 7
      zone: order.deliveryArea,
    },
    trackingNumber: order.trackingNumber,
    note: order.notes,
    customer: {
      id: customer.id,
      name: customer.name,
      pictureUrl: customer.pictureUrl,
      earlierOrderCount: history.count,
      spentBefore: history.spent,
    },
    conversationId: order.conversationId,
    placedAt: order.placedAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/** `data` is jsonb, so it is parsed rather than trusted. */
export function toOrderEvent({ event, actor }: OrderEventWithActor): OrderEvent {
  return {
    id: event.id,
    data: orderEventDataSchema.parse(event.data),
    actor,
    createdAt: event.createdAt.toISOString(),
  };
}
