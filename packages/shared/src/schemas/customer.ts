import { z } from 'zod';
import { phoneSchema } from './auth';
import { conversationStateSchema, messageSenderSchema } from './conversation';
import {
  pageNumber,
  pagePaginationSchema,
  pageSizeOf,
  searchTerm,
  sortDirectionSchema,
} from './list-query';
import { orderStatusSchema } from './order';

/**
 * One badge per customer, the first that applies:
 * - `needs_you`: one of their conversations is handed off to the seller.
 * - `inactive`: no message and no order for INACTIVE_AFTER_DAYS.
 * - `repeat`: REPEAT_MIN_ORDERS or more orders.
 * - `new`: everyone else.
 * Cancelled and returned orders never count.
 */
export const customerStatuses = ['needs_you', 'inactive', 'repeat', 'new'] as const;
export const customerStatusSchema = z.enum(customerStatuses);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

export const INACTIVE_AFTER_DAYS = 60;
export const REPEAT_MIN_ORDERS = 2;
/** The window behind "new this month" and the average-order-value trend. */
export const CUSTOMER_STATS_WINDOW_DAYS = 30;

/** The Customers page's tabs: everyone, or one status. */
export const customerFilters = ['all', ...customerStatuses] as const;
export const customerFilterSchema = z.enum(customerFilters);
export type CustomerFilter = z.infer<typeof customerFilterSchema>;

export const customerSorts = ['last_order', 'orders', 'total_spent'] as const;
export const customerSortSchema = z.enum(customerSorts);
export type CustomerSort = z.infer<typeof customerSortSchema>;

export const customerPageSizes = [10, 25, 50, 100] as const;

/**
 * GET /customers. `q` matches name, phone or area. Customers with no orders
 * sort last whichever the direction.
 */
export const listCustomersQuerySchema = z.object({
  filter: customerFilterSchema.default('all'),
  q: searchTerm,
  sort: customerSortSchema.default('last_order'),
  direction: sortDirectionSchema.default('desc'),
  page: pageNumber,
  pageSize: pageSizeOf(customerPageSizes),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/** GET /customers/:id/orders. */
export const listCustomerOrdersQuerySchema = z.object({
  page: pageNumber,
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListCustomerOrdersQuery = z.infer<typeof listCustomerOrdersQuerySchema>;

/** Order figures; money in minor units. Cancelled and returned orders are left out. */
export const customerOrderStatsSchema = z.object({
  orderCount: z.number().int().nonnegative(),
  totalSpent: z.number().int().nonnegative(),
  lastOrderAt: z.string().datetime().nullable(),
});

export const customerListItemSchema = customerOrderStatsSchema.extend({
  id: z.string().uuid(),
  /** Null until Facebook shares the customer's profile. */
  name: z.string().nullable(),
  /** Facebook's signed CDN link. It expires, so the image may fail to load. */
  pictureUrl: z.string().url().nullable(),
  phone: z.string().nullable(),
  area: z.string().nullable(),
  status: customerStatusSchema,
  /** The latest message or order, whichever is later; first contact if neither. */
  lastActiveAt: z.string().datetime(),
});
export type CustomerListItem = z.infer<typeof customerListItemSchema>;

export const customerListResponseSchema = z.object({
  data: z.array(customerListItemSchema),
  pagination: pagePaginationSchema,
});
export type CustomerListResponse = z.infer<typeof customerListResponseSchema>;

/** GET /customers/summary: the stat cards and the tab counts. Ignores search. */
export const customerSummarySchema = z.object({
  counts: z.object({
    all: z.number().int().nonnegative(),
    needsYou: z.number().int().nonnegative(),
    inactive: z.number().int().nonnegative(),
    repeat: z.number().int().nonnegative(),
    new: z.number().int().nonnegative(),
  }),
  /** First contact within the last CUSTOMER_STATS_WINDOW_DAYS. */
  newInWindow: z.number().int().nonnegative(),
  /** Customers with REPEAT_MIN_ORDERS or more orders, whatever their badge. */
  repeatCustomers: z.number().int().nonnegative(),
  /** Customers with at least one order. */
  customersWithOrders: z.number().int().nonnegative(),
  /** Minor units, rounded; null when there were no orders to average. */
  averageOrderValue: z.object({
    allTime: z.number().int().nonnegative().nullable(),
    currentWindow: z.number().int().nonnegative().nullable(),
    previousWindow: z.number().int().nonnegative().nullable(),
  }),
});
export type CustomerSummary = z.infer<typeof customerSummarySchema>;

export const customerDetailSchema = customerListItemSchema.extend({
  deliveryAddress: z.string().nullable(),
  /** Rounded minor units; null with no orders. */
  averageOrderValue: z.number().int().nonnegative().nullable(),
  /** First contact. */
  createdAt: z.string().datetime(),
  /** Their most recently active conversation; null if they have none. */
  latestConversation: z
    .object({
      id: z.string().uuid(),
      state: conversationStateSchema,
      botPaused: z.boolean(),
      lastMessage: z.object({
        preview: z.string(),
        sender: messageSenderSchema,
        at: z.string().datetime(),
      }),
    })
    .nullable(),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export const customerOrderSchema = z.object({
  id: z.string().uuid(),
  /** ORD-2026-00481: the order's identifier, shown to the seller and sent to the customer. */
  reference: z.string().min(1),
  /** The shop's own order number within `year`, counted from 1 each year. */
  number: z.number().int().positive(),
  /** The calendar year it was placed, in the shop's time zone. */
  year: z.number().int().positive(),
  status: orderStatusSchema,
  /** Minor units, delivery included. */
  total: z.number().int().nonnegative(),
  placedAt: z.string().datetime(),
  items: z.array(
    z.object({
      productName: z.string(),
      variantName: z.string().nullable(),
      quantity: z.number().int().positive(),
    }),
  ),
});
export type CustomerOrder = z.infer<typeof customerOrderSchema>;

export const customerOrderPageSchema = z.object({
  data: z.array(customerOrderSchema),
  pagination: pagePaginationSchema,
});
export type CustomerOrderPage = z.infer<typeof customerOrderPageSchema>;

export const CUSTOMER_ADDRESS_MAX_LENGTH = 500;
export const CUSTOMER_AREA_MAX_LENGTH = 100;

/** A blank field clears the value. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema.nullable(),
  );

/** PATCH /customers/:id: the contact details. Omit a field to leave it alone. */
export const updateCustomerSchema = z
  .object({
    phone: clearable(phoneSchema).optional(),
    deliveryAddress: clearable(z.string().trim().max(CUSTOMER_ADDRESS_MAX_LENGTH)).optional(),
    area: clearable(z.string().trim().max(CUSTOMER_AREA_MAX_LENGTH)).optional(),
  })
  .strict();
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;

export const CUSTOMER_NOTE_MAX_LENGTH = 2000;

/** POST /customers/:id/notes. */
export const createCustomerNoteSchema = z
  .object({ body: z.string().trim().min(1).max(CUSTOMER_NOTE_MAX_LENGTH) })
  .strict();
export type CreateCustomerNote = z.infer<typeof createCustomerNoteSchema>;

export const customerNoteSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  /** Null once the author's account is deleted. */
  author: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.string().datetime(),
});
export type CustomerNote = z.infer<typeof customerNoteSchema>;
