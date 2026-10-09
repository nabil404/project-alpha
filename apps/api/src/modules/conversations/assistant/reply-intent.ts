import type { CollectedSlots, CustomerIntent, SlotName } from '@app/shared';

/** The filled slots, as phrasing and checkReply see them. Phase 2 adds prices and stock. */
export type ReplyFacts = Pick<
  CollectedSlots,
  'productText' | 'variantText' | 'quantity' | 'customerName' | 'phone' | 'deliveryAddress'
>;

export type HandoffReason =
  | 'llm_failed'
  | 'low_confidence'
  | 'complain'
  | 'request_human'
  | 'question'
  | 'repeated_confusion'
  | 'awaiting_seller';

/** What the turn says, decided by code. The LLM only words it. */
export type ReplyIntent =
  | {
      kind: 'ask_slot';
      slot: SlotName;
      intent: CustomerIntent;
      invalidPhone: boolean;
      facts: ReplyFacts;
    }
  | { kind: 'summary'; facts: ReplyFacts }
  | { kind: 'handoff'; reason: HandoffReason };

export function factsOf(slots: CollectedSlots): ReplyFacts {
  const facts: ReplyFacts = {};
  if (slots.productText !== undefined) facts.productText = slots.productText;
  if (slots.variantText !== undefined) facts.variantText = slots.variantText;
  if (slots.quantity !== undefined) facts.quantity = slots.quantity;
  if (slots.customerName !== undefined) facts.customerName = slots.customerName;
  if (slots.phone !== undefined) facts.phone = slots.phone;
  if (slots.deliveryAddress !== undefined) facts.deliveryAddress = slots.deliveryAddress;
  return facts;
}
