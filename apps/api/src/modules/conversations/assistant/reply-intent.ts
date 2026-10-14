import type { CustomerIntent, OrderStatus, Quote, SlotName } from '@app/shared';

/** One item as the reply may speak of it: catalog names, formatted money. */
export interface LineFacts {
  productName: string;
  variantName?: string;
  quantity?: number;
  /** Formatted in the shop's currency. */
  unitPrice?: string;
  lineTotal?: string;
  inStock?: boolean;
  /** Only when the customer asked for more than this. */
  available?: number;
}

/**
 * Everything a phrased reply may state, from the catalog and the shop's
 * delivery settings. checkReply allows only the numbers found here.
 */
export interface ReplyFacts {
  items: LineFacts[];
  customerName?: string;
  /** E.164. */
  phone?: string;
  deliveryAddress?: string;
  /** A product or variant just found out of stock, by name. */
  unavailable?: string;
  areaName?: string;
  deliveryFee?: string;
  subtotal?: string;
  total?: string;
}

export type HandoffReason =
  | 'llm_failed'
  | 'low_confidence'
  | 'complain'
  | 'request_human'
  | 'question'
  | 'repeated_confusion'
  | 'awaiting_seller'
  | 'no_delivery_charge'
  | 'unreadable';

/** Why a slot is asked for again, when it is not just missing. */
export type AskReason =
  | 'invalid_phone'
  | 'not_found'
  | 'choose'
  | 'unavailable'
  | 'out_of_stock'
  | 'product_out_of_stock'
  | 'too_many';

/** A candidate offered as a quick reply. */
export interface Choice {
  id: string;
  title: string;
}

/** What the turn says, decided by code. The LLM only words it, and never the summary. */
export type ReplyIntent =
  | {
      kind: 'ask_slot';
      slot: SlotName;
      /** The item the slot belongs to, for product, variant and quantity. */
      item?: number;
      intent: CustomerIntent;
      reason?: AskReason;
      choices?: Choice[];
      facts: ReplyFacts;
    }
  | { kind: 'summary'; quote: Quote; facts: ReplyFacts }
  | { kind: 'browse_categories'; choices: Choice[] }
  | { kind: 'browse_products'; cards: ProductCard[]; more: boolean }
  | { kind: 'last_order'; order: LastOrderFacts | null }
  | { kind: 'notice'; notice: Notice }
  | { kind: 'handoff'; reason: HandoffReason };

/** A fixed line for a message without words; it changes no state. */
export type Notice =
  'use_confirm' | 'type_please' | 'location_write_address' | 'location_seen' | 'text_only';

/** One carousel card: a product with its lowest available price. */
export interface ProductCard {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
}

/** The customer's most recent order, as the reply may state it. */
export interface LastOrderFacts {
  reference: string;
  status: OrderStatus;
  /** Formatted in the shop's currency. */
  total: string;
}
