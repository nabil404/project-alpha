import { z } from 'zod';

/** New -> Confirmed -> Packed -> Shipped -> Delivered, or Cancelled. */
export const orderStatuses = [
  'new',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
] as const;

export const orderStatusSchema = z.enum(orderStatuses);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

const orderStatusTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return orderStatusTransitions[from].includes(to);
}

export const orderItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantity: z.number().int().positive(),
  /** Minor units, snapshotted from the catalog at confirmation time. */
  unitPrice: z.number().int().nonnegative(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const createOrderSchema = z.object({
  conversationId: z.string().uuid(),
  customerId: z.string().uuid(),
  items: z.array(orderItemSchema).min(1),
  deliveryCharge: z.number().int().nonnegative(),
  notes: z.string().max(2000).optional(),
});
export type CreateOrder = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
  note: z.string().max(2000).optional(),
});
