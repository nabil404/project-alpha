import {
  hasCollectedAnything,
  nextMissingSlot,
  parseCustomerPhone,
  type CollectedSlots,
  type ConversationState,
  type CustomerIntent,
  type ExtractedOrder,
  type IntentResult,
} from '@app/shared';
import type { HandoffReason, ReplyFacts, ReplyIntent } from './reply-intent';

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
  state: _state,
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

  const missing = nextMissingSlot(merged.slots, () => false);
  if (missing === null) {
    // Catalog matching fills product ids; until then a complete order waits for the shop.
    return handOff(merged.slots, 'awaiting_seller');
  }
  const item = 'item' in missing ? missing.item : undefined;
  const last = merged.slots.lastAsked;
  const times = last?.slot === missing.slot && last.item === item ? last.times + 1 : 1;
  if (times >= MAX_ASKS) return handOff(merged.slots, 'repeated_confusion');

  return {
    state: hasCollectedAnything(merged.slots) ? 'collecting_details' : 'browsing',
    slots: { ...merged.slots, lastAsked: { slot: missing.slot, item, times } },
    reply: {
      kind: 'ask_slot',
      slot: missing.slot,
      ...(item === undefined ? {} : { item }),
      intent: classified.intent,
      ...(merged.invalidPhone ? { reason: 'invalid_phone' as const } : {}),
      facts: factsOf(merged.slots),
    },
  };
}

export function factsOf(slots: CollectedSlots): ReplyFacts {
  const facts: ReplyFacts = {
    items: slots.items.flatMap((item) =>
      item.productQuery === undefined
        ? []
        : [
            {
              productName: item.productQuery,
              ...(item.quantity === undefined ? {} : { quantity: item.quantity }),
            },
          ],
    ),
  };
  if (slots.customerName !== undefined) facts.customerName = slots.customerName;
  if (slots.phone !== undefined) facts.phone = slots.phone;
  if (slots.deliveryAddress !== undefined) facts.deliveryAddress = slots.deliveryAddress;
  return facts;
}

/** An extraction that filled nothing says nothing about how sure it is. */
function isEmptyExtraction(extraction: ExtractedOrder): boolean {
  const { confidence: _confidence, ...fields } = extraction;
  return Object.values(fields).every((value) => value === null);
}

/** A non-null field replaces the slot; null never does. A phone is kept only if it is a real number. */
export function mergeExtraction(
  slots: CollectedSlots,
  extraction: ExtractedOrder,
  country: string,
): { slots: CollectedSlots; invalidPhone: boolean } {
  const next: CollectedSlots = { ...slots };
  if (extraction.items !== null) {
    next.items = extraction.items.flatMap((entry) => {
      const product = words(entry.productQuery);
      const kept = entry.ref === null ? undefined : slots.items[entry.ref];
      if (product === undefined && kept === undefined) return [];
      const quantity = entry.quantity ?? kept?.quantity;
      return [
        {
          ...(kept && (product === undefined || product === kept.productQuery) ? kept : {}),
          productQuery: product ?? kept?.productQuery,
          ...(quantity === undefined ? {} : { quantity }),
        },
      ];
    });
  }
  const name = words(extraction.customerName);
  if (name !== undefined) next.customerName = name;
  const address = words(extraction.deliveryAddress);
  if (address !== undefined) next.deliveryAddress = address;
  const area = words(extraction.deliveryArea);
  if (area !== undefined) next.deliveryArea = area;

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
