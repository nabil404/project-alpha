import {
  customerIntentSchema,
  emptySlots,
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

const nothing: ExtractedOrder = {
  items: null,
  customerName: null,
  phone: null,
  deliveryAddress: null,
  deliveryArea: null,
  confidence: 0.9,
};
const item = (productQuery: string, quantity: number | null = null) => ({
  ref: null,
  productQuery,
  productQueryAlt: null,
  variantQuery: null,
  variantQueryAlt: null,
  quantity,
});
const slots = (overrides: Partial<CollectedSlots> = {}): CollectedSlots => ({
  ...emptySlots(),
  ...overrides,
});

const turn = (overrides: Partial<TurnInput> = {}): TurnInput => ({
  state: 'browsing',
  slots: emptySlots(),
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
      const { reply } = decideTurn(turn({ state, classified: asked(intent) }));
      if (intent === 'complain' || intent === 'request_human') {
        expect(reply).toEqual({ kind: 'handoff', reason: intent });
      } else if (intent === 'ask_question') {
        expect(reply).toEqual({ kind: 'handoff', reason: 'question' });
      } else {
        expect(reply).toMatchObject({ kind: 'ask_slot', slot: 'product', intent });
      }
    },
  );
});

describe('decideTurn', () => {
  it('hands off, keeping the slots, when classification or extraction failed', () => {
    expect(
      decideTurn(turn({ slots: slots({ customerName: 'Rahim' }), classified: 'failed' })),
    ).toEqual({
      state: 'handed_off',
      slots: slots({ customerName: 'Rahim', lastAsked: undefined }),
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
    expect(
      decideTurn(turn({ extracted: { ...nothing, customerName: 'Rahim', confidence: 0.5 } })).reply,
    ).toEqual({
      kind: 'handoff',
      reason: 'low_confidence',
    });
  });

  it('stays browsing and asks for the product when nothing is known', () => {
    expect(decideTurn(turn({ classified: asked('browse') }))).toEqual({
      state: 'browsing',
      slots: slots({ lastAsked: { slot: 'product', item: 0, times: 1 } }),
      reply: {
        kind: 'ask_slot',
        slot: 'product',
        item: 0,
        intent: 'browse',
        facts: { items: [] },
      },
    });
  });

  it("keeps the customer's words for each item", () => {
    const decision = decideTurn(
      turn({ extracted: { ...nothing, items: [item('red saree', 2), item('lipstick')] } }),
    );
    expect(decision.state).toBe('collecting_details');
    expect(decision.slots.items).toEqual([
      { productQuery: 'red saree', quantity: 2 },
      { productQuery: 'lipstick' },
    ]);
  });

  it('never lets a null overwrite a slot, and lets a value replace one', () => {
    const kept = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({
          items: [{ productQuery: 'red saree', quantity: 2 }],
          customerName: 'Rahim',
        }),
        extracted: nothing,
      }),
    );
    expect(kept.slots).toMatchObject({
      items: [{ productQuery: 'red saree', quantity: 2 }],
      customerName: 'Rahim',
    });

    const edited = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({ customerName: 'Rahim' }),
        classified: asked('edit_order'),
        extracted: { ...nothing, customerName: 'Karim' },
      }),
    );
    expect(edited.slots.customerName).toBe('Karim');
  });

  it('stores a valid phone as E.164, Bangla digits included', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        classified: asked('other'),
        extracted: { ...nothing, phone: '০১৮১২-০০০০০০' },
      }),
    );
    expect(decision.slots.phone).toBe('+8801812000000');
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'product' });
    expect(decision.reply).not.toHaveProperty('reason');
  });

  it('flags an invalid phone and keeps the slot empty', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        classified: asked('other'),
        extracted: { ...nothing, phone: '0181200000' },
      }),
    );
    expect(decision.slots.phone).toBeUndefined();
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', reason: 'invalid_phone' });
  });

  it('hands off instead of asking for the same slot a third time', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({ lastAsked: { slot: 'product', item: 0, times: 2 } }),
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
        slots: slots({ lastAsked: { slot: 'phone', times: 2 } }),
        classified: asked('other'),
        extracted: nothing,
      }),
    );
    expect(decision.slots.lastAsked).toEqual({ slot: 'product', item: 0, times: 1 });
  });

  it('keeps what a question carried, then hands off', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        classified: asked('ask_question'),
        extracted: { ...nothing, deliveryAddress: 'Sylhet sadar' },
      }),
    );
    expect(decision.state).toBe('handed_off');
    expect(decision.slots.deliveryAddress).toBe('Sylhet sadar');
    expect(decision.reply).toEqual({ kind: 'handoff', reason: 'question' });
  });

  it('ignores low extraction confidence when nothing was extracted', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        classified: asked('other'),
        extracted: { ...nothing, confidence: 0.1 },
      }),
    );
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'product' });
  });
});
