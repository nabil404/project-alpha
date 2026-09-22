import { z } from 'zod';

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

/** Output shape for extractOrder(). Names are raw customer words, not catalog ids. */
export const extractedOrderSchema = z.object({
  productName: z.string().nullable(),
  variantName: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedOrder = z.infer<typeof extractedOrderSchema>;
