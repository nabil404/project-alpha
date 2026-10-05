import { z } from 'zod';
import { phoneSchema } from './auth';
import {
  pageNumber,
  pagePaginationSchema,
  pageSizeOf,
  searchTerm,
  sortDirectionSchema,
} from './list-query';

/** New -> Confirmed -> Packed -> Shipped -> Delivered -> Returned, or Cancelled. */
export const orderStatuses = [
  'new',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
] as const;

export const orderStatusSchema = z.enum(orderStatuses);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

const orderStatusTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: ['returned'],
  returned: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return orderStatusTransitions[from].includes(to);
}

/** The statuses an order in `from` can move to next, in lifecycle order. */
export function nextOrderStatuses(from: OrderStatus): readonly OrderStatus[] {
  return orderStatusTransitions[from];
}

/**
 * Whether an order in this status holds its items' stock. Stock is taken when
 * the seller confirms and given back when the order is cancelled or returned,
 * so a move's stock effect is the difference between its two ends.
 */
export function orderHoldsStock(status: OrderStatus): boolean {
  return (
    status === 'confirmed' || status === 'packed' || status === 'shipped' || status === 'delivered'
  );
}

/** Items can change until the order is packed. */
export function orderItemsEditable(status: OrderStatus): boolean {
  return status === 'new' || status === 'confirmed';
}

/** The delivery details can change until the order ships. */
export function orderDeliveryEditable(status: OrderStatus): boolean {
  return status === 'new' || status === 'confirmed' || status === 'packed';
}

/** Who put the order in: the assistant from a Messenger chat, or the seller by hand. */
export const orderSources = ['assistant', 'seller'] as const;
export const orderSourceSchema = z.enum(orderSources);
export type OrderSource = z.infer<typeof orderSourceSchema>;

/** Recorded by the seller; the MVP takes no payments itself. */
export const paymentStatuses = ['unpaid', 'paid', 'refunded'] as const;
export const paymentStatusSchema = z.enum(paymentStatuses);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentMethods = ['cash_on_delivery', 'bank_transfer', 'mobile_wallet'] as const;
export const paymentMethodSchema = z.enum(paymentMethods);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** The Orders page's tabs: everything, or one status. */
export const orderFilters = ['all', ...orderStatuses] as const;
export const orderFilterSchema = z.enum(orderFilters);
export type OrderFilter = z.infer<typeof orderFilterSchema>;

export const orderSorts = ['placed_at', 'total'] as const;
export const orderSortSchema = z.enum(orderSorts);
export type OrderSort = z.infer<typeof orderSortSchema>;

export const orderPageSizes = [10, 25, 50, 100] as const;

/** The window behind the revenue and assistant-share cards. */
export const ORDER_STATS_WINDOW_DAYS = 30;

const instant = z.string().datetime({ offset: true });

/**
 * The date filter, `from` inclusive and `to` exclusive. The page turns "Today"
 * or "This month" into instants in the shop's time zone, so the API never
 * guesses one.
 */
const placedRange = {
  from: instant.optional(),
  to: instant.optional(),
};
const rangeInOrder = (range: { from?: string; to?: string }) =>
  !range.from || !range.to || Date.parse(range.from) < Date.parse(range.to);
const rangeIssue = { path: ['to'], params: { code: 'INVALID_VALUE' } };

/**
 * GET /orders. `q` matches the order reference, whole or in part, or a bare
 * order number in any year, or the customer's name or phone (digits alone
 * match a formatted number).
 */
export const listOrdersQuerySchema = z
  .object({
    status: orderFilterSchema.default('all'),
    q: searchTerm,
    ...placedRange,
    sort: orderSortSchema.default('placed_at'),
    direction: sortDirectionSchema.default('desc'),
    page: pageNumber,
    pageSize: pageSizeOf(orderPageSizes),
  })
  .refine(rangeInOrder, rangeIssue);
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

/** GET /orders/summary. The tab counts follow the list's search and dates; the cards do not. */
export const orderSummaryQuerySchema = z
  .object({ q: searchTerm, ...placedRange })
  .refine(rangeInOrder, rangeIssue);
export type OrderSummaryQuery = z.infer<typeof orderSummaryQuerySchema>;

const count = z.number().int().nonnegative();
const money = z.number().int().nonnegative();

export const orderListItemSchema = z.object({
  id: z.string().uuid(),
  /** ORD-2026-00481: the order's identifier, shown to the seller and sent to the customer. */
  reference: z.string().min(1),
  /** The shop's own order number within `year`, counted from 1 each year. */
  number: z.number().int().positive(),
  /** The calendar year it was placed, in the shop's time zone. */
  year: z.number().int().positive(),
  source: orderSourceSchema,
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  paymentMethod: paymentMethodSchema,
  /** The name and phone the order was placed with. */
  customer: z.object({ id: z.string().uuid(), name: z.string(), phone: z.string() }),
  /** The first line, for the list; `itemCount` counts every line. */
  firstItem: z.object({
    productName: z.string(),
    variantName: z.string().nullable(),
    quantity: z.number().int().positive(),
  }),
  itemCount: z.number().int().positive(),
  /** Minor units of `currency`, delivery included. */
  total: money,
  currency: z.string().length(3),
  placedAt: z.string().datetime(),
});
export type OrderListItem = z.infer<typeof orderListItemSchema>;

export const orderListResponseSchema = z.object({
  data: z.array(orderListItemSchema),
  pagination: pagePaginationSchema,
});
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

export const orderSummarySchema = z.object({
  /** Per tab, under the same search and dates as the list. */
  counts: z.object({
    all: count,
    new: count,
    confirmed: count,
    packed: count,
    shipped: count,
    delivered: count,
    returned: count,
    cancelled: count,
  }),
  /** Drafted orders waiting for the seller, whenever they were placed. */
  awaitingConfirmation: count,
  /** Confirmed or packed: still to go out. */
  toShip: z.object({ confirmed: count, packed: count }),
  /**
   * Minor units of the shop's currency, over the last ORDER_STATS_WINDOW_DAYS
   * and the window before. Cancelled and returned orders never count.
   */
  revenue: z.object({ currentWindow: money, previousWindow: money }),
  /** Orders placed in the current window, and how many the assistant drafted. */
  placedInWindow: z.object({ all: count, byAssistant: count }),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const orderLineSchema = z.object({
  id: z.string().uuid(),
  /** Null only for orders from before the catalog link was kept. */
  productId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
  /** Snapshots: the order reads the same after the catalog changes. */
  productName: z.string(),
  variantName: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().int().positive(),
  unitPrice: money,
  lineTotal: money,
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const orderDetailSchema = z.object({
  id: z.string().uuid(),
  /** ORD-2026-00481: the order's identifier, shown to the seller and sent to the customer. */
  reference: z.string().min(1),
  /** The shop's own order number within `year`, counted from 1 each year. */
  number: z.number().int().positive(),
  /** The calendar year it was placed, in the shop's time zone. */
  year: z.number().int().positive(),
  /** Opaque. Send it back with a change; a change from an older read is refused with ORDER_STALE. */
  version: z.string().min(1),
  source: orderSourceSchema,
  status: orderStatusSchema,
  /** Where the order can go from here; empty once it is done. */
  nextStatuses: z.array(orderStatusSchema),
  paymentStatus: paymentStatusSchema,
  paymentMethod: paymentMethodSchema,
  currency: z.string().length(3),
  subtotal: money,
  deliveryFee: money,
  total: money,
  items: z.array(orderLineSchema),
  /** The delivery details the order was placed with; editing the customer never changes them. */
  delivery: z.object({
    name: z.string(),
    phone: z.string(),
    address: z.string(),
    /** The area's name when it was delivered there; null for everywhere else or none. Kept when the area goes. */
    area: z.string().nullable(),
    /** The Settings delivery charge it was priced by; null once that area is removed, or for none. */
    chargeId: z.string().uuid().nullable(),
    /** Priced at the shop's everywhere-else charge. */
    everywhereElse: z.boolean(),
    /** The estimate when priced, e.g. "1–2 days" after shipping. */
    time: z.string().nullable(),
  }),
  trackingNumber: z.string().nullable(),
  /** The seller's own note; the customer never sees it. */
  note: z.string().nullable(),
  customer: z.object({
    id: z.string().uuid(),
    /** The customer as they are now, unlike `delivery`. Null until Facebook shares a name. */
    name: z.string().nullable(),
    pictureUrl: z.string().url().nullable(),
    /** Their orders placed before this one, cancelled and returned ones left out. */
    earlierOrderCount: count,
    spentBefore: money,
  }),
  /** The Messenger conversation it came from; null for an order the seller added. */
  conversationId: z.string().uuid().nullable(),
  placedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const ORDER_MAX_ITEMS = 50;
export const ORDER_NOTE_MAX_LENGTH = 2000;
export const ORDER_NAME_MAX_LENGTH = 200;
export const ORDER_ADDRESS_MAX_LENGTH = 500;
export const ORDER_AREA_MAX_LENGTH = 100;
export const ORDER_TRACKING_MAX_LENGTH = 100;

/** A blank field clears the value. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema.nullable(),
  );

/**
 * One line of a new item list. `unitPrice` defaults to the line's current
 * price when the variant is already on the order, else to the catalog's.
 */
export const orderItemInputSchema = z
  .object({
    variantId: z.string().uuid(),
    quantity: z.number().int().positive().max(9999),
    unitPrice: money.optional(),
  })
  .strict();
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

const itemList = z
  .array(orderItemInputSchema)
  .min(1)
  .max(ORDER_MAX_ITEMS)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.variantId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'variantId'],
          message: 'This variant is already on the order',
          params: { code: 'DUPLICATE' },
        });
      }
      seen.add(item.variantId);
    });
  });

const nameInput = z.string().trim().min(1).max(ORDER_NAME_MAX_LENGTH);
const addressInput = z.string().trim().min(1).max(ORDER_ADDRESS_MAX_LENGTH);
const areaInput = clearable(z.string().trim().max(ORDER_AREA_MAX_LENGTH));
const chargeIdInput = z.string().uuid().nullable();
const noteInput = clearable(z.string().trim().max(ORDER_NOTE_MAX_LENGTH));
const versionInput = z.string().min(1);

/**
 * POST /orders: an order the seller enters for a customer who has messaged
 * the Page. It starts as `new`, like one the assistant drafts. Name, phone and
 * address default to the customer's details on file.
 */
export const createOrderSchema = z
  .object({
    customerId: z.string().uuid(),
    items: itemList,
    deliveryFee: money,
    deliveryArea: areaInput.optional(),
    deliveryChargeId: chargeIdInput.optional(),
    customerName: nameInput.optional(),
    phone: phoneSchema.optional(),
    deliveryAddress: addressInput.optional(),
    paymentMethod: paymentMethodSchema.default('cash_on_delivery'),
    note: noteInput.optional(),
  })
  .strict();
export type CreateOrder = z.infer<typeof createOrderSchema>;

/** POST /orders/:id/status. */
export const updateOrderStatusSchema = z
  .object({
    status: orderStatusSchema,
    /** Kept on the order's activity, e.g. why it was cancelled. */
    note: z.string().trim().max(ORDER_NOTE_MAX_LENGTH).optional(),
    version: versionInput,
  })
  .strict();
export type UpdateOrderStatus = z.infer<typeof updateOrderStatusSchema>;

/** PUT /orders/:id/items: the whole list, while the order is new or confirmed. */
export const replaceOrderItemsSchema = z
  .object({ items: itemList, version: versionInput })
  .strict();
export type ReplaceOrderItems = z.infer<typeof replaceOrderItemsSchema>;

/**
 * PATCH /orders/:id. Omit a field to leave it. The delivery fields change only
 * until the order ships; payment, tracking and the note at any time.
 * `deliveryChargeId` links a Settings delivery charge (an area or everywhere
 * else) and snapshots its name, everywhere-else flag and estimate; a sent
 * `deliveryArea` overrides the name, and `null` unlinks and clears them. The
 * fee is never recomputed.
 */
export const updateOrderSchema = z
  .object({
    customerName: nameInput.optional(),
    phone: phoneSchema.optional(),
    deliveryAddress: addressInput.optional(),
    deliveryArea: areaInput.optional(),
    deliveryChargeId: chargeIdInput.optional(),
    deliveryFee: money.optional(),
    paymentStatus: paymentStatusSchema.optional(),
    paymentMethod: paymentMethodSchema.optional(),
    trackingNumber: clearable(z.string().trim().max(ORDER_TRACKING_MAX_LENGTH)).optional(),
    note: noteInput.optional(),
    version: versionInput,
  })
  .strict();
export type UpdateOrder = z.infer<typeof updateOrderSchema>;

export const orderDeliveryFields = ['name', 'phone', 'address', 'area', 'fee'] as const;
/** Events stored before the rename say `zone` and `charge`; they read as `area` and `fee`. */
const renamedDeliveryFields: Record<string, (typeof orderDeliveryFields)[number]> = {
  zone: 'area',
  charge: 'fee',
};
export const orderDeliveryFieldSchema = z.preprocess(
  (value) => (typeof value === 'string' ? (renamedDeliveryFields[value] ?? value) : value),
  z.enum(orderDeliveryFields),
);
export type OrderDeliveryField = z.infer<typeof orderDeliveryFieldSchema>;

/** What happened, with the facts the timeline shows; stored as jsonb and parsed on read. */
export const orderEventDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('created'), source: orderSourceSchema }),
  z.object({
    type: z.literal('status_changed'),
    from: orderStatusSchema,
    to: orderStatusSchema,
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal('items_changed'),
    totalBefore: money,
    totalAfter: money,
  }),
  z.object({
    type: z.literal('delivery_changed'),
    fields: z.array(orderDeliveryFieldSchema).min(1),
  }),
  z.object({
    type: z.literal('payment_changed'),
    status: z.object({ from: paymentStatusSchema, to: paymentStatusSchema }).optional(),
    method: z.object({ from: paymentMethodSchema, to: paymentMethodSchema }).optional(),
  }),
  z.object({ type: z.literal('tracking_changed'), trackingNumber: z.string().nullable() }),
]);
export type OrderEventData = z.infer<typeof orderEventDataSchema>;
export type OrderEventType = OrderEventData['type'];
export const orderEventTypes = [
  'created',
  'status_changed',
  'items_changed',
  'delivery_changed',
  'payment_changed',
  'tracking_changed',
] as const satisfies readonly OrderEventType[];

export const orderEventSchema = z.object({
  id: z.string().uuid(),
  data: orderEventDataSchema,
  /** The seller who did it; null for the assistant, or once their account is deleted. */
  actor: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.string().datetime(),
});
export type OrderEvent = z.infer<typeof orderEventSchema>;
