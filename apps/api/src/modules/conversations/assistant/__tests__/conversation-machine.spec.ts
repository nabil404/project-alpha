import {
  customerIntentSchema,
  type CollectedSlots,
  type CustomerIntent,
  type ExtractedOrder,
} from '@app/shared';
import {
  decideTurn,
  shouldExtract,
  type ActiveState,
  type TurnInput,
} from '../conversation-machine';

const intents = customerIntentSchema.options;
const activeStates: ActiveState[] = [
  'browsing',
  'collecting_details',
  'awaiting_confirmation',
  'abandoned',
];

const FULL: CollectedSlots = {
  productText: 'red saree',
  quantity: 2,
  customerName: 'Rahim',
  phone: '+8801812000000',
  deliveryAddress: 'House 12, Road 5, Dhanmondi',
};

const nothing: ExtractedOrder = {
  productName: null,
  variantName: null,
  quantity: null,
  customerName: null,
  phone: null,
  deliveryAddress: null,
  confidence: 0.9,
};

const turn = (overrides: Partial<TurnInput> = {}): TurnInput => ({
  state: 'browsing',
  slots: {},
  classified: { intent: 'order', confidence: 0.9 },
  extracted: 'skipped',
  country: 'BD',
  ...overrides,
});
const asked = (intent: CustomerIntent, confidence = 0.9) => ({ intent, confidence });

describe('shouldExtract', () => {
  it.each(activeStates.flatMap((state) => intents.map((intent) => [state, intent] as const)))(
    '%s × %s',
    (state, intent) => {
      const expected =
        intent === 'complain' || intent === 'request_human'
          ? false
          : state === 'collecting_details' || state === 'awaiting_confirmation'
            ? true
            : intent === 'order' || intent === 'edit_order';
      expect(shouldExtract(state, intent)).toBe(expected);
    },
  );
});

describe('decideTurn: every state × intent', () => {
  it.each(activeStates.flatMap((state) => intents.map((intent) => [state, intent] as const)))(
    '%s × %s',
    (state, intent) => {
      const slots = state === 'awaiting_confirmation' ? FULL : {};
      const { reply } = decideTurn(turn({ state, slots, classified: asked(intent) }));
      if (intent === 'complain' || intent === 'request_human') {
        expect(reply).toEqual({ kind: 'handoff', reason: intent });
      } else if (intent === 'ask_question') {
        expect(reply).toEqual({ kind: 'handoff', reason: 'question' });
      } else if (state === 'awaiting_confirmation') {
        expect(reply.kind).toBe('summary');
      } else {
        expect(reply).toMatchObject({ kind: 'ask_slot', slot: 'product', intent });
      }
    },
  );
});

describe('decideTurn', () => {
  it('hands off, keeping the slots, when classification or extraction failed', () => {
    expect(decideTurn(turn({ slots: { quantity: 2 }, classified: 'failed' }))).toEqual({
      state: 'handed_off',
      slots: { quantity: 2, lastAsked: undefined },
      reply: { kind: 'handoff', reason: 'llm_failed' },
    });
    expect(decideTurn(turn({ extracted: 'failed' })).reply).toEqual({
      kind: 'handoff',
      reason: 'llm_failed',
    });
  });

  it('hands off below the confidence floor, for either call', () => {
    expect(decideTurn(turn({ classified: asked('order', 0.59) })).reply).toEqual({
      kind: 'handoff',
      reason: 'low_confidence',
    });
    expect(decideTurn(turn({ extracted: { ...nothing, confidence: 0.5 } })).reply).toEqual({
      kind: 'handoff',
      reason: 'low_confidence',
    });
  });

  it('stays browsing and asks for the product when nothing is known', () => {
    expect(decideTurn(turn({ classified: asked('browse') }))).toEqual({
      state: 'browsing',
      slots: { lastAsked: { slot: 'product', times: 1 } },
      reply: {
        kind: 'ask_slot',
        slot: 'product',
        intent: 'browse',
        invalidPhone: false,
        facts: {},
      },
    });
  });

  it('fills slots from an order and asks for the next one', () => {
    const decision = decideTurn(
      turn({ extracted: { ...nothing, productName: 'red saree', variantName: 'XL', quantity: 2 } }),
    );
    expect(decision.state).toBe('collecting_details');
    expect(decision.slots).toMatchObject({
      productText: 'red saree',
      variantText: 'XL',
      quantity: 2,
    });
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'customerName' });
  });

  it('never lets a null overwrite a slot, and lets a value replace one', () => {
    const kept = decideTurn(
      turn({
        state: 'collecting_details',
        slots: { productText: 'red saree', quantity: 2 },
        extracted: nothing,
      }),
    );
    expect(kept.slots).toMatchObject({ productText: 'red saree', quantity: 2 });

    const edited = decideTurn(
      turn({
        state: 'collecting_details',
        slots: { productText: 'red saree', quantity: 2 },
        classified: asked('edit_order'),
        extracted: { ...nothing, quantity: 3 },
      }),
    );
    expect(edited.slots.quantity).toBe(3);
  });

  it('drops the old variant when the product changes without a new one', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: { productText: 'red saree', variantText: 'XL', quantity: 1 },
        extracted: { ...nothing, productName: 'blue panjabi' },
      }),
    );
    expect(decision.slots.productText).toBe('blue panjabi');
    expect(decision.slots.variantText).toBeUndefined();
  });

  it('stores a valid phone as E.164, Bangla digits included', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: { productText: 'red saree', quantity: 1, customerName: 'Rahim' },
        classified: asked('other'),
        extracted: { ...nothing, phone: '০১৮১২-০০০০০০' },
      }),
    );
    expect(decision.slots.phone).toBe('+8801812000000');
    expect(decision.reply).toMatchObject({
      kind: 'ask_slot',
      slot: 'deliveryAddress',
      invalidPhone: false,
    });
  });

  it('re-asks for an invalid phone with the hint, and counts the ask', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: {
          productText: 'red saree',
          quantity: 1,
          customerName: 'Rahim',
          lastAsked: { slot: 'phone', times: 1 },
        },
        classified: asked('other'),
        extracted: { ...nothing, phone: '0181200000' },
      }),
    );
    expect(decision.slots.phone).toBeUndefined();
    expect(decision.slots.lastAsked).toEqual({ slot: 'phone', times: 2 });
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'phone', invalidPhone: true });
  });

  it('hands off instead of asking for the same slot a third time', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: { productText: 'red saree', lastAsked: { slot: 'quantity', times: 2 } },
        classified: asked('other'),
        extracted: nothing,
      }),
    );
    expect(decision.state).toBe('handed_off');
    expect(decision.reply).toEqual({ kind: 'handoff', reason: 'repeated_confusion' });
  });

  it('restarts the count when a different slot is asked', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: { productText: 'red saree', lastAsked: { slot: 'product', times: 2 } },
        classified: asked('other'),
        extracted: nothing,
      }),
    );
    expect(decision.slots.lastAsked).toEqual({ slot: 'quantity', times: 1 });
  });

  it('keeps what a question carried, then hands off', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: { productText: 'red saree' },
        classified: asked('ask_question'),
        extracted: { ...nothing, deliveryAddress: 'Sylhet sadar' },
      }),
    );
    expect(decision.state).toBe('handed_off');
    expect(decision.slots.deliveryAddress).toBe('Sylhet sadar');
    expect(decision.reply).toEqual({ kind: 'handoff', reason: 'question' });
  });

  it('moves to awaiting_confirmation with a summary once every slot is filled', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: {
          ...FULL,
          deliveryAddress: undefined,
          lastAsked: { slot: 'deliveryAddress', times: 1 },
        },
        classified: asked('other'),
        extracted: { ...nothing, deliveryAddress: 'House 12, Road 5, Dhanmondi' },
      }),
    );
    expect(decision.state).toBe('awaiting_confirmation');
    expect(decision.slots.lastAsked).toBeUndefined();
    expect(decision.reply).toEqual({ kind: 'summary', facts: FULL });
  });

  it('re-sends the summary while awaiting confirmation, with any edit applied', () => {
    const decision = decideTurn(
      turn({
        state: 'awaiting_confirmation',
        slots: FULL,
        classified: asked('edit_order'),
        extracted: { ...nothing, quantity: 3 },
      }),
    );
    expect(decision.state).toBe('awaiting_confirmation');
    expect(decision.reply).toEqual({ kind: 'summary', facts: { ...FULL, quantity: 3 } });
  });
});
