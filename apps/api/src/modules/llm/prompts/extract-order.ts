import type { CollectedSlots } from '@app/shared';
import type { ChatLine } from '../llm.types';
import { asData, DATA_RULE, transcript } from './transcript';

export const EXTRACT_ORDER_SYSTEM = `You extract order details a customer gave in a Facebook Messenger chat with an online shop. The chat may be in Bangla, Banglish or English.

Rules:
- productName and variantName: the customer's own words for the product and its variant (colour, size). Do not translate, correct or guess a catalog name.
- quantity: a whole number, only when the customer said how many.
- customerName, phone, deliveryAddress: as the customer wrote them.
- Use null for anything the customer has not given. Never invent a value.
- When the customer changes a detail, return the new value.
- confidence is a number from 0 to 1: how sure you are of the fields you filled. If you filled nothing, return confidence 1.

${DATA_RULE}`;

export function extractOrderPrompt(history: ChatLine[], slots: CollectedSlots): string {
  const known = { ...slots, lastAsked: undefined, productId: undefined, variantId: undefined };
  return `Details already collected: ${asData(known)}\n\n${transcript(history)}`;
}
