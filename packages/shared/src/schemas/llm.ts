import { z } from 'zod';
import { MAX_ORDER_ITEMS } from './conversation';

/**
 * The LLM only parses. Everything it returns is validated against the seller's
 * catalog by code before it can reach a customer or an order.
 */
export const customerIntentSchema = z.enum([
  'browse',
  'order',
  'ask_question',
  'edit_order',
  'complain',
  'request_human',
  'other',
]);
export type CustomerIntent = z.infer<typeof customerIntentSchema>;

export const intentResultSchema = z.object({
  intent: customerIntentSchema,
  confidence: z.number().min(0).max(1),
});
export type IntentResult = z.infer<typeof intentResultSchema>;

/**
 * One item as the customer now wants it. `ref` is the index of the collected
 * item it continues, or null for a new one. Words are the customer's own, and
 * `*Alt` holds them transliterated into the other script (Bangla ⇄ Latin), not
 * translated. With a `ref`, words are null unless the customer changed that
 * item's product or variant, and then name only the new choice.
 */
export const extractedItemSchema = z.object({
  ref: z.number().int().nonnegative().nullable(),
  productQuery: z.string().nullable(),
  productQueryAlt: z.string().nullable(),
  variantQuery: z.string().nullable(),
  variantQueryAlt: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
});
export type ExtractedItem = z.infer<typeof extractedItemSchema>;

/**
 * Output shape for extractOrder(). `items` is the customer's whole list after
 * this message, or null when the message said nothing about items; an item
 * left out of a returned list is removed. Raw words only, never catalog ids.
 */
export const extractedOrderSchema = z.object({
  items: z.array(extractedItemSchema).max(MAX_ORDER_ITEMS).nullable(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  /** The area or district the customer named, else null. */
  deliveryArea: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedOrder = z.infer<typeof extractedOrderSchema>;
