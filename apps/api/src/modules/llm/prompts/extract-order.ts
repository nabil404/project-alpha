import type { ChatLine, ExtractionContext } from '../llm.types';
import { asData, DATA_RULE, transcript } from './transcript';

export const EXTRACT_ORDER_SYSTEM = `You extract order details a customer gave in a Facebook Messenger chat with an online shop. The chat may be in Bangla, Banglish (Bangla in Latin letters) or English. A customer may order several items.

Items:
- items is the customer's whole list of items after their latest message, in order. Return null when the latest message says nothing about items (only a name, phone or address, a greeting, a question).
- Each item has ref: the index of the already-collected item it continues (as listed in "Already collected"), or null for an item the customer newly asks for.
- To change an item, return the list with that item changed ("make it 2" changes the quantity of the item being discussed). To remove an item, return the list without it. Keep every other item as it is, with its ref.
- productQuery and variantQuery: the customer's own words for the product and for its variant (colour, size), copied as written. Do not translate, correct or guess a catalog name. Use null when the customer gave none for that item.
- On an item with a ref, productQuery is null unless the customer changed which product that item is; mentioning the same product again ("make the saree 3", "the red one") is not a change. When they did change it, productQuery holds only their words for the product they want now, never words for one they turned down: "not katan, jamdani" gives "jamdani"; "jamdani instead of katan" gives "jamdani"; "কাতান না, জামদানি" gives "জামদানি". variantQuery follows the same rule for the variant: null unless the customer changed it, and then only the variant they want ("not red, blue" gives "blue").
- "Already collected" shows each item's catalog name (product, variant) and the customer's earlier words for it (customerWords, customerVariantWords), so you can tell which item the customer means. Never copy them back as productQuery or variantQuery.
- productQueryAlt and variantQueryAlt: the same words transliterated into the other script: Bangla script into Latin letters, or Latin letters (English or Banglish) into Bangla script. Spell the sounds, never translate the meaning. Null when the query is null.
- quantity: a whole number, only when the customer said how many of that item.

Details:
- customerName, phone, deliveryAddress: as the customer wrote them.
- deliveryArea: the area, thana or district the customer named for delivery (for example "Mirpur" or "Chattogram"), as written; null if they named none.
- Use null for anything the customer has not given. Never invent a value. When the customer changes a detail, return the new value.

confidence is a number from 0 to 1: how sure you are of what you returned. If you returned nothing (items null and every detail null), return confidence 1.

${DATA_RULE}`;

export function extractOrderPrompt(history: ChatLine[], context: ExtractionContext): string {
  return `Already collected: ${asData(context)}\n\n${transcript(history)}`;
}
