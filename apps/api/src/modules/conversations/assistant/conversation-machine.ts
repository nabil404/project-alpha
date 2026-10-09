import {
  isSlotFilled,
  nextMissingSlot,
  parseCustomerPhone,
  slotNames,
  type CollectedSlots,
  type ConversationState,
  type CustomerIntent,
  type ExtractedOrder,
  type IntentResult,
} from '@app/shared';
import { factsOf, type HandoffReason, type ReplyIntent } from './reply-intent';

/** Below this, from either call, the assistant hands off instead of guessing. */
export const CONFIDENCE_FLOOR = 0.6;
/** The third ask for the same slot in a row hands off instead. */
export const MAX_ASKS = 3;

/** States a turn may run in; the ingest never queues one for the others. */
export type ActiveState = Exclude<ConversationState, 'handed_off' | 'confirmed'>;

export function isActiveState(state: ConversationState): state is ActiveState {
  return state !== 'handed_off' && state !== 'confirmed';
}

export interface TurnInput {
  state: ActiveState;
  slots: CollectedSlots;
  classified: IntentResult | 'failed';
  extracted: ExtractedOrder | 'failed' | 'skipped';
  /** The shop's country: the region a local phone number is read in. */
  country: string;
}

export interface TurnDecision {
  state: ConversationState;
  slots: CollectedSlots;
  reply: ReplyIntent;
}

/**
 * Mid-flow, a bare answer ("01812…", "Rahim") is often classified `other`, so
 * extraction runs on every turn there; while browsing only an order needs it.
 */
export function shouldExtract(state: ActiveState, intent: CustomerIntent): boolean {
  if (intent === 'complain' || intent === 'request_human') return false;
  if (state === 'collecting_details' || state === 'awaiting_confirmation') return true;
  return intent === 'order' || intent === 'edit_order';
}

export function decideTurn({
  state,
  slots,
  classified,
  extracted,
  country,
}: TurnInput): TurnDecision {
  if (classified === 'failed' || extracted === 'failed') return handOff(slots, 'llm_failed');
  if (classified.intent === 'complain' || classified.intent === 'request_human') {
    return handOff(slots, classified.intent);
  }
  if (
    classified.confidence < CONFIDENCE_FLOOR ||
    (extracted !== 'skipped' &&
      !isEmptyExtraction(extracted) &&
      extracted.confidence < CONFIDENCE_FLOOR)
  ) {
    return handOff(slots, 'low_confidence');
  }

  const merged =
    extracted === 'skipped'
      ? { slots, invalidPhone: false }
      : mergeExtraction(slots, extracted, country);
  if (classified.intent === 'ask_question') return handOff(merged.slots, 'question');

  const slot = nextMissingSlot(merged.slots);
  if (slot === null) {
    // The customer already saw the summary and added nothing: it is the shop's move.
    if (state === 'awaiting_confirmation' && sameSlots(slots, merged.slots)) {
      return handOff(merged.slots, 'awaiting_seller');
    }
    return {
      state: 'awaiting_confirmation',
      slots: { ...merged.slots, lastAsked: undefined },
      reply: { kind: 'summary', facts: factsOf(merged.slots) },
    };
  }
  const times = merged.slots.lastAsked?.slot === slot ? merged.slots.lastAsked.times + 1 : 1;
  if (times >= MAX_ASKS) return handOff(merged.slots, 'repeated_confusion');

  const anyFilled = slotNames.some((name) => isSlotFilled(merged.slots, name));
  return {
    state: anyFilled ? 'collecting_details' : 'browsing',
    slots: { ...merged.slots, lastAsked: { slot, times } },
    reply: {
      kind: 'ask_slot',
      slot,
      intent: classified.intent,
      invalidPhone: merged.invalidPhone,
      facts: factsOf(merged.slots),
    },
  };
}

/** An extraction that filled nothing says nothing about how sure it is. */
function isEmptyExtraction(extraction: ExtractedOrder): boolean {
  const { confidence: _confidence, ...fields } = extraction;
  return Object.values(fields).every((value) => value === null);
}

function sameSlots(a: CollectedSlots, b: CollectedSlots): boolean {
  const x = factsOf(a);
  const y = factsOf(b);
  return (
    (Object.keys(x) as (keyof typeof x)[]).length === Object.keys(y).length &&
    (Object.keys(x) as (keyof typeof x)[]).every((key) => x[key] === y[key])
  );
}

/** A non-null field replaces the slot; null never does. A phone is kept only if it is a real number. */
export function mergeExtraction(
  slots: CollectedSlots,
  extraction: ExtractedOrder,
  country: string,
): { slots: CollectedSlots; invalidPhone: boolean } {
  const next: CollectedSlots = { ...slots };
  const product = words(extraction.productName);
  const variant = words(extraction.variantName);
  if (product !== undefined && product !== slots.productText) {
    next.productText = product;
    // The old variant belonged to the old product.
    if (variant === undefined) next.variantText = undefined;
  }
  if (variant !== undefined) next.variantText = variant;
  if (extraction.quantity !== null) next.quantity = extraction.quantity;
  const name = words(extraction.customerName);
  if (name !== undefined) next.customerName = name;
  const address = words(extraction.deliveryAddress);
  if (address !== undefined) next.deliveryAddress = address;

  let invalidPhone = false;
  const phoneText = words(extraction.phone);
  if (phoneText !== undefined) {
    const phone = parseCustomerPhone(phoneText, country);
    if (phone === null) invalidPhone = true;
    else next.phone = phone;
  }
  return { slots: next, invalidPhone };
}

function words(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function handOff(slots: CollectedSlots, reason: HandoffReason): TurnDecision {
  return {
    state: 'handed_off',
    slots: { ...slots, lastAsked: undefined },
    reply: { kind: 'handoff', reason },
  };
}
