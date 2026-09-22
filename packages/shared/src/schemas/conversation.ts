import { z } from 'zod';

/** browsing -> collecting_details -> awaiting_confirmation -> confirmed, plus handed_off and abandoned. */
export const conversationStates = [
  'browsing',
  'collecting_details',
  'awaiting_confirmation',
  'confirmed',
  'handed_off',
  'abandoned',
] as const;

export const conversationStateSchema = z.enum(conversationStates);
export type ConversationState = z.infer<typeof conversationStateSchema>;

/** Every field the state machine must collect before a summary can be shown. */
export const requiredOrderFields = [
  'product',
  'variant',
  'quantity',
  'customerName',
  'phone',
  'deliveryAddress',
] as const;

export const collectedSlotsSchema = z.object({
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().positive().optional(),
  customerName: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  deliveryAddress: z.string().min(1).optional(),
});
export type CollectedSlots = z.infer<typeof collectedSlotsSchema>;

export const messageDirectionSchema = z.enum(['inbound', 'outbound']);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

export function missingSlots(slots: CollectedSlots): string[] {
  const required: (keyof CollectedSlots)[] = [
    'productId',
    'variantId',
    'quantity',
    'customerName',
    'phone',
    'deliveryAddress',
  ];
  return required.filter((field) => slots[field] === undefined);
}
