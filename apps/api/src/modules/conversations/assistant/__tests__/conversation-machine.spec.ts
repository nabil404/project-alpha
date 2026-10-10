import {
  customerIntentSchema,
  emptySlots,
  type CollectedSlots,
  type CustomerIntent,
  type ExtractedItem,
  type ExtractedOrder,
  type IntentResult,
  type Product,
} from '@app/shared';
import type { CatalogView, DeliveryArea } from '../catalog-match';
import {
  decideTurn,
  shouldExtract,
  validPick,
  type ActiveState,
  type DeliveryView,
  type TurnInput,
} from '../conversation-machine';
import { EVAL_CATALOG, EVAL_PRODUCTS, productByKey } from './fixtures/match-eval';

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
const said = (overrides: Partial<ExtractedItem>): ExtractedItem => ({
  ref: null,
  productQuery: null,
  productQueryAlt: null,
  variantQuery: null,
  variantQueryAlt: null,
  quantity: null,
  ...overrides,
});
const slots = (overrides: Partial<CollectedSlots> = {}): CollectedSlots => ({
  ...emptySlots(),
  ...overrides,
});

const DHAKA: DeliveryArea = {
  id: '00000000-0000-4000-8000-00000000d001',
  areaName: 'Dhaka',
  charge: 6_000,
};
const ELSEWHERE: DeliveryArea = {
  id: '00000000-0000-4000-8000-00000000d009',
  areaName: null,
  charge: 12_000,
};
const DELIVERY: DeliveryView = {
  areas: [DHAKA],
  fallback: ELSEWHERE,
  freeDeliveryOver: null,
  currency: 'BDT',
};

const lungi = productByKey('lungi');
const jamdani = productByKey('jamdani');
const panjabi = productByKey('panjabi');
const kajal = productByKey('kajal');
const variantOf = (product: Product, name: string | null) =>
  product.variants.find((variant) => variant.name === name)!;
const RED = variantOf(jamdani, 'Red');

const asked = (intent: CustomerIntent, confidence = 0.9): IntentResult => ({ intent, confidence });
const message = (
  extracted: ExtractedOrder | 'failed' | 'skipped' = 'skipped',
  classified: IntentResult | 'failed' = asked('order'),
): TurnInput['trigger'] => ({ kind: 'message', classified, extracted });

const turn = (overrides: Partial<TurnInput> = {}): TurnInput => ({
  state: 'browsing',
  slots: emptySlots(),
  trigger: message(),
  country: 'BD',
  language: 'en',
  catalog: EVAL_CATALOG,
  delivery: DELIVERY,
  ...overrides,
});

/** Everything but the items, filled. */
const DETAILS = {
  customerName: 'Rahim',
  phone: '+8801812000000',
  deliveryAddress: 'House 12, Dhanmondi, Dhaka',
};

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
      const { reply } = decideTurn(turn({ state, trigger: message('skipped', asked(intent)) }));
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

describe('decideTurn: hand-offs', () => {
  it('hands off, keeping the slots, when classification or extraction failed', () => {
    expect(
      decideTurn(
        turn({ slots: slots({ customerName: 'Rahim' }), trigger: message('skipped', 'failed') }),
      ),
    ).toEqual({
      state: 'handed_off',
      slots: slots({ customerName: 'Rahim' }),
      reply: { kind: 'handoff', reason: 'llm_failed' },
    });
    expect(decideTurn(turn({ trigger: message('failed') })).reply).toEqual({
      kind: 'handoff',
      reason: 'llm_failed',
    });
  });

  it('hands off below the confidence floor, for either call', () => {
    expect(decideTurn(turn({ trigger: message('skipped', asked('order', 0.59)) })).reply).toEqual({
      kind: 'handoff',
      reason: 'low_confidence',
    });
    expect(
      decideTurn(turn({ trigger: message({ ...nothing, customerName: 'Rahim', confidence: 0.5 }) }))
        .reply,
    ).toEqual({ kind: 'handoff', reason: 'low_confidence' });
  });

  it('ignores low extraction confidence when nothing was extracted', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        trigger: message({ ...nothing, confidence: 0.1 }, asked('other')),
      }),
    );
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'product' });
  });

  it('keeps what a question carried, then hands off', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        trigger: message({ ...nothing, deliveryAddress: 'Sylhet sadar' }, asked('ask_question')),
      }),
    );
    expect(decision.state).toBe('handed_off');
    expect(decision.slots.deliveryAddress).toBe('Sylhet sadar');
    expect(decision.reply).toEqual({ kind: 'handoff', reason: 'question' });
  });

  it('hands off instead of asking for the same slot of the same item a third time', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({ lastAsked: { slot: 'product', item: 0, times: 2 } }),
        trigger: message(nothing, asked('other')),
      }),
    );
    expect(decision.reply).toEqual({ kind: 'handoff', reason: 'repeated_confusion' });
  });

  it('restarts the count when a different slot is asked', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({ lastAsked: { slot: 'phone', times: 2 } }),
        trigger: message(nothing, asked('other')),
      }),
    );
    expect(decision.slots.lastAsked).toEqual({ slot: 'product', item: 0, times: 1 });
  });

  it('hands off a complete order the shop has no delivery charge for', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({
          items: [{ productQuery: 'lungi', quantity: 1 }],
          ...DETAILS,
          deliveryAddress: 'Sylhet',
        }),
        delivery: { ...DELIVERY, fallback: null },
      }),
    );
    expect(decision.reply).toEqual({ kind: 'handoff', reason: 'no_delivery_charge' });
  });
});

describe('decideTurn: products and variants', () => {
  it('stays browsing and asks for a product when nothing is known', () => {
    expect(decideTurn(turn({ trigger: message('skipped', asked('browse')) }))).toEqual({
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

  it('fills a product with one variant and asks how many, with no variant question', () => {
    const decision = decideTurn(
      turn({ trigger: message({ ...nothing, items: [said({ productQuery: 'lungi' })] }) }),
    );
    expect(decision.slots.items).toEqual([
      { productQuery: 'lungi', productId: lungi.id, variantId: lungi.variants[0]!.id },
    ]);
    expect(decision.reply).toMatchObject({
      kind: 'ask_slot',
      slot: 'quantity',
      item: 0,
      facts: {
        items: [{ productName: 'Check Lungi', unitPrice: expect.stringContaining('1,600') }],
      },
    });
  });

  it('asks for the variant of a product with options, offering the in-stock ones', () => {
    const decision = decideTurn(
      turn({ trigger: message({ ...nothing, items: [said({ productQuery: 'jamdani saree' })] }) }),
    );
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'variant', item: 0 });
    const choices = decision.reply.kind === 'ask_slot' ? decision.reply.choices : undefined;
    expect(choices?.map((choice) => choice.title)).toEqual(['Red', 'Blue', 'Green']);
    expect(decision.slots.offered).toEqual({
      slot: 'variant',
      item: 0,
      ids: jamdani.variants.map((variant) => variant.id),
    });
  });

  it('fills the variant from the words the customer gave with the product', () => {
    const decision = decideTurn(
      turn({
        trigger: message({
          ...nothing,
          items: [said({ productQuery: 'jamdani', variantQuery: 'red', quantity: 2 })],
        }),
      }),
    );
    expect(decision.slots.items[0]).toMatchObject({
      productId: jamdani.id,
      variantId: RED.id,
      quantity: 2,
    });
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'customerName' });
  });

  it('offers the close candidates for an unclear product, and a tap on one fills it', () => {
    const decision = decideTurn(
      turn({ trigger: message({ ...nothing, items: [said({ productQuery: 'saree' })] }) }),
    );
    expect(decision.reply).toMatchObject({
      kind: 'ask_slot',
      slot: 'product',
      item: 0,
      reason: 'choose',
    });
    expect(decision.slots.offered).toEqual({
      slot: 'product',
      item: 0,
      ids: expect.arrayContaining([jamdani.id, productByKey('katan').id]),
    });

    const pick = validPick(decision.slots, { slot: 'product', id: jamdani.id })!;
    expect(pick).toEqual({ slot: 'product', item: 0, id: jamdani.id });
    const picked = decideTurn(
      turn({
        state: 'collecting_details',
        slots: decision.slots,
        trigger: { kind: 'pick', pick },
      }),
    );
    expect(picked.slots.items[0]).toMatchObject({ productQuery: 'saree', productId: jamdani.id });
    expect(picked.reply).toMatchObject({ kind: 'ask_slot', slot: 'variant', item: 0 });
  });

  it('refuses a tap on a candidate that was not offered', () => {
    const offered = slots({ offered: { slot: 'product', item: 0, ids: [jamdani.id] } });
    expect(validPick(offered, { slot: 'product', id: lungi.id })).toBeNull();
    expect(validPick(offered, { slot: 'variant', id: jamdani.id })).toBeNull();
    expect(validPick(slots(), { slot: 'product', id: jamdani.id })).toBeNull();
  });

  it('says so when nothing matches, and counts it toward the hand-off', () => {
    const first = decideTurn(
      turn({ trigger: message({ ...nothing, items: [said({ productQuery: 'iphone' })] }) }),
    );
    expect(first.reply).toMatchObject({ kind: 'ask_slot', slot: 'product', reason: 'not_found' });
    const second = decideTurn(
      turn({
        state: 'collecting_details',
        slots: first.slots,
        trigger: message(nothing, asked('other')),
      }),
    );
    expect(second.slots.lastAsked).toEqual({ slot: 'product', item: 0, times: 2 });
    const third = decideTurn(
      turn({
        state: 'collecting_details',
        slots: second.slots,
        trigger: message(nothing, asked('other')),
      }),
    );
    expect(third.reply).toEqual({ kind: 'handoff', reason: 'repeated_confusion' });
  });

  it('never fills an out-of-stock variant, and offers only the in-stock ones', () => {
    const decision = decideTurn(
      turn({
        trigger: message({
          ...nothing,
          items: [said({ productQuery: 'panjabi', variantQuery: 'black 42' })],
        }),
      }),
    );
    expect(decision.slots.items[0]?.variantId).toBeUndefined();
    expect(decision.reply).toMatchObject({
      kind: 'ask_slot',
      slot: 'variant',
      reason: 'out_of_stock',
      facts: { unavailable: '42 / Black' },
    });
    const titles =
      decision.reply.kind === 'ask_slot'
        ? decision.reply.choices?.map((choice) => choice.title)
        : [];
    expect(titles).toHaveLength(5);
    expect(titles).not.toContain('42 / Black');
    expect(decision.slots.offered?.ids).not.toContain(variantOf(panjabi, '42 / Black').id);
  });

  it('asks for another product when no variant of it is in stock', () => {
    const soldOut: Product = {
      ...lungi,
      variants: [{ ...lungi.variants[0]!, stock: 0, stockStatus: 'out_of_stock' }],
    };
    const decision = decideTurn(
      turn({
        catalog: { products: [soldOut] },
        trigger: message({ ...nothing, items: [said({ productQuery: 'lungi', quantity: 1 })] }),
      }),
    );
    expect(decision.slots.items[0]?.productId).toBeUndefined();
    expect(decision.reply).toMatchObject({
      kind: 'ask_slot',
      slot: 'product',
      reason: 'product_out_of_stock',
      facts: { unavailable: 'Check Lungi' },
    });
  });

  it('asks again for a quantity above the stock, saying how many there are', () => {
    const decision = decideTurn(
      turn({
        trigger: message({ ...nothing, items: [said({ productQuery: 'lungi', quantity: 9 })] }),
      }),
    );
    expect(decision.slots.items[0]?.quantity).toBeUndefined();
    expect(decision.reply).toMatchObject({
      kind: 'ask_slot',
      slot: 'quantity',
      reason: 'too_many',
      facts: { items: [{ productName: 'Check Lungi', available: 5 }] },
    });
  });

  it('drops a matched product the catalog no longer sells and matches the words again', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({ items: [{ productQuery: 'lungi', productId: kajal.id, quantity: 1 }] }),
        catalog: { products: [lungi] },
        trigger: message(nothing, asked('other')),
      }),
    );
    expect(decision.slots.items[0]).toMatchObject({ productId: lungi.id });
  });
});

describe('decideTurn: several items', () => {
  it('takes two products in one message as two items', () => {
    const decision = decideTurn(
      turn({
        trigger: message({
          ...nothing,
          items: [said({ productQuery: 'lungi', quantity: 2 }), said({ productQuery: 'kajal' })],
        }),
      }),
    );
    expect(decision.slots.items).toEqual([
      {
        productQuery: 'lungi',
        productId: lungi.id,
        variantId: lungi.variants[0]!.id,
        quantity: 2,
      },
      { productQuery: 'kajal', productId: kajal.id, variantId: kajal.variants[0]!.id },
    ]);
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'quantity', item: 1 });
  });

  const twoItems = slots({
    items: [
      {
        productQuery: 'lungi',
        productId: lungi.id,
        variantId: lungi.variants[0]!.id,
        quantity: 2,
      },
      { productQuery: 'kajal', productId: kajal.id, variantId: kajal.variants[0]!.id, quantity: 1 },
    ],
    ...DETAILS,
  });

  it('changes only the quantity of the item the customer meant', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: twoItems,
        trigger: message(
          {
            ...nothing,
            items: [said({ ref: 0 }), said({ ref: 1, productQuery: 'kajal', quantity: 3 })],
          },
          asked('edit_order'),
        ),
      }),
    );
    expect(decision.slots.items.map((item) => item.quantity)).toEqual([2, 3]);
  });

  it("keeps the matched variant when extraction echoes the catalog's product name", () => {
    const katan = productByKey('katan');
    const katanRed = variantOf(katan, 'Red');
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({
          items: [
            {
              productQuery: 'saree',
              productId: katan.id,
              variantQuery: 'red',
              variantId: katanRed.id,
            },
          ],
        }),
        trigger: message(
          {
            ...nothing,
            items: [said({ ref: 0, productQuery: 'Katan Silk Saree', quantity: 3 })],
          },
          asked('edit_order'),
        ),
      }),
    );
    expect(decision.slots.items).toEqual([
      expect.objectContaining({ productId: katan.id, variantId: katanRed.id, quantity: 3 }),
    ]);
  });

  it('keeps the picked product when new words for it still name it among others', () => {
    const katan = productByKey('katan');
    const katanRed = variantOf(katan, 'Red');
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({
          items: [
            {
              productQuery: 'red saree',
              productId: katan.id,
              variantQuery: 'red',
              variantId: katanRed.id,
              quantity: 1,
            },
          ],
        }),
        trigger: message(
          { ...nothing, items: [said({ ref: 0, productQuery: 'saree', quantity: 3 })] },
          asked('edit_order'),
        ),
      }),
    );
    expect(decision.slots.items).toEqual([
      expect.objectContaining({ productId: katan.id, variantId: katanRed.id, quantity: 3 }),
    ]);
  });

  it('clears the product when new words name a different one', () => {
    const katan = productByKey('katan');
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({
          items: [
            {
              productQuery: 'saree',
              productId: katan.id,
              variantQuery: 'red',
              variantId: variantOf(katan, 'Red').id,
            },
          ],
        }),
        trigger: message(
          { ...nothing, items: [said({ ref: 0, productQuery: 'jamdani saree' })] },
          asked('edit_order'),
        ),
      }),
    );
    expect(decision.slots.items).toEqual([
      { productQuery: 'jamdani saree', productId: jamdani.id },
    ]);
  });

  describe('new words on a picked item', () => {
    const katan = productByKey('katan');
    const picked = (product: Product, query: string) => {
      const variant = product.variants[0]!;
      return slots({
        items: [
          {
            productQuery: query,
            productId: product.id,
            ...(variant.name === null ? {} : { variantQuery: variant.name }),
            variantId: variant.id,
            quantity: 1,
          },
        ],
      });
    };
    const after = (current: CollectedSlots, productQuery: string) =>
      decideTurn(
        turn({
          state: 'collecting_details',
          slots: current,
          trigger: message(
            { ...nothing, items: [said({ ref: 0, productQuery })] },
            asked('edit_order'),
          ),
        }),
      ).slots.items[0]!;

    it.each([
      'not katan, jamdani',
      'jamdani instead of katan',
      'Jamdani Saree instead of Katan Silk Saree',
    ])('lets go of the Katan Saree for %s', (words) => {
      expect(after(picked(katan, 'katan'), words).productId).not.toBe(katan.id);
    });

    it('lets go of the lungi for a check shirt', () => {
      expect(after(picked(lungi, 'lungi'), 'check shirt').productId).not.toBe(lungi.id);
    });

    it.each(['saree', 'red saree', 'Katan Silk Saree'])('keeps the Katan Saree for %s', (words) => {
      const item = after(picked(katan, 'katan'), words);
      expect(item).toEqual(
        expect.objectContaining({ productId: katan.id, variantId: variantOf(katan, 'Red').id }),
      );
    });

    it('keeps the Katan Saree when only one script of the words is its own', () => {
      const item = decideTurn(
        turn({
          state: 'collecting_details',
          slots: picked(katan, 'katan'),
          trigger: message(
            {
              ...nothing,
              items: [said({ ref: 0, productQuery: 'red saree', productQueryAlt: 'রেড শাড়ি' })],
            },
            asked('edit_order'),
          ),
        }),
      ).slots.items[0]!;
      expect(item).toEqual(expect.objectContaining({ productId: katan.id }));
    });

    it('never keeps A when the customer asks for B instead, over every pair of products', () => {
      const kept: string[] = [];
      for (const a of EVAL_PRODUCTS) {
        for (const b of EVAL_PRODUCTS) {
          if (a === b) continue;
          for (const words of [
            `not the ${a.name}, the ${b.name}`,
            `${b.name} instead of ${a.name}`,
          ]) {
            if (after(picked(a, a.name), words).productId === a.id) kept.push(`${a.key}: ${words}`);
          }
        }
      }
      expect(kept).toEqual([]);
    });
  });

  it('removes the item the customer dropped', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: twoItems,
        trigger: message({ ...nothing, items: [said({ ref: 1 })] }, asked('edit_order')),
      }),
    );
    expect(decision.slots.items.map((item) => item.productId)).toEqual([kajal.id]);
  });

  it("counts the asks afresh for the item that moved into a removed one's place", () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({
          items: [
            { productQuery: 'lungi', productId: lungi.id, variantId: lungi.variants[0]!.id },
            { productQuery: 'kajal', productId: kajal.id, variantId: kajal.variants[0]!.id },
          ],
          lastAsked: { slot: 'quantity', item: 0, times: 2 },
        }),
        trigger: message(
          { ...nothing, items: [said({ ref: 1, productQuery: 'kajal' })] },
          asked('edit_order'),
        ),
      }),
    );
    expect(decision.reply).toMatchObject({ kind: 'ask_slot', slot: 'quantity', item: 0 });
    expect(decision.slots.lastAsked).toEqual({ slot: 'quantity', item: 0, times: 1 });
  });

  it('keeps counting the asks for an item that moved up', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({
          items: [
            { productQuery: 'lungi', productId: lungi.id, variantId: lungi.variants[0]!.id },
            { productQuery: 'kajal', productId: kajal.id, variantId: kajal.variants[0]!.id },
          ],
          lastAsked: { slot: 'quantity', item: 1, times: 1 },
        }),
        trigger: message(
          { ...nothing, items: [said({ ref: 1, productQuery: 'kajal' })] },
          asked('edit_order'),
        ),
      }),
    );
    expect(decision.slots.lastAsked).toEqual({ slot: 'quantity', item: 0, times: 2 });
  });

  it('merges two items on the same variant, quantities summed', () => {
    const decision = decideTurn(
      turn({
        trigger: message({
          ...nothing,
          items: [
            said({ productQuery: 'jamdani', variantQuery: 'red', quantity: 1 }),
            said({ productQuery: 'red jamdani saree', variantQuery: 'red', quantity: 2 }),
          ],
        }),
      }),
    );
    expect(decision.slots.items).toEqual([
      expect.objectContaining({ productId: jamdani.id, variantId: RED.id, quantity: 3 }),
    ]);
  });
});

describe('decideTurn: the summary', () => {
  const ready = slots({
    items: [
      {
        productQuery: 'lungi',
        productId: lungi.id,
        variantId: lungi.variants[0]!.id,
        quantity: 2,
      },
      { productQuery: 'kajal', productId: kajal.id, variantId: kajal.variants[0]!.id, quantity: 1 },
    ],
    ...DETAILS,
  });
  const complete = (overrides: Partial<TurnInput> = {}) =>
    decideTurn(
      turn({
        state: 'collecting_details',
        slots: ready,
        trigger: message(nothing, asked('other')),
        ...overrides,
      }),
    );

  it('quotes every line from the catalog, matches the area, and bumps the revision', () => {
    const decision = complete();
    expect(decision.state).toBe('awaiting_confirmation');
    const quote = {
      revision: 1,
      lines: [
        {
          productId: lungi.id,
          variantId: lungi.variants[0]!.id,
          quantity: 2,
          unitPrice: 160_000,
          lineTotal: 320_000,
        },
        {
          productId: kajal.id,
          variantId: kajal.variants[0]!.id,
          quantity: 1,
          unitPrice: 210_000,
          lineTotal: 210_000,
        },
      ],
      subtotal: 530_000,
      deliveryChargeId: DHAKA.id,
      deliveryFee: 6_000,
      total: 536_000,
      currency: 'BDT',
    };
    expect(decision.slots).toMatchObject({ revision: 1, quote, deliveryChargeId: DHAKA.id });
    expect(decision.slots.lastAsked).toBeUndefined();
    expect(decision.reply).toMatchObject({
      kind: 'summary',
      quote,
      facts: { areaName: 'Dhaka', total: expect.stringContaining('5,360') },
    });
  });

  it("charges the highest of the products' own charges for the area", () => {
    const withCharge = (product: Product, charge: number): Product => ({
      ...product,
      customDelivery: true,
      deliveryCharges: [{ deliveryChargeId: DHAKA.id, charge }],
    });
    const catalog: CatalogView = {
      products: [withCharge(lungi, 9_000), withCharge(kajal, 7_000)],
    };
    expect(complete({ catalog }).slots.quote?.deliveryFee).toBe(9_000);
  });

  it('delivers free once the subtotal reaches the threshold', () => {
    const quote = complete({ delivery: { ...DELIVERY, freeDeliveryOver: 530_000 } }).slots.quote;
    expect(quote).toMatchObject({ deliveryFee: 0, total: 530_000 });
  });

  it('falls back to everywhere else for an address in no named area', () => {
    const quote = complete({ slots: { ...ready, deliveryAddress: 'Zindabazar, Sylhet' } }).slots
      .quote;
    expect(quote).toMatchObject({ deliveryChargeId: ELSEWHERE.id, deliveryFee: 12_000 });
  });

  it('sends a new card with the next revision when the order is edited after the summary', () => {
    const shown = complete();
    const edited = decideTurn(
      turn({
        state: 'awaiting_confirmation',
        slots: shown.slots,
        trigger: message(
          { ...nothing, items: [said({ ref: 0, quantity: 1 }), said({ ref: 1 })] },
          asked('edit_order'),
        ),
      }),
    );
    expect(edited.state).toBe('awaiting_confirmation');
    expect(edited.slots.revision).toBe(2);
    expect(edited.slots.quote).toMatchObject({ revision: 2, subtotal: 370_000 });
  });

  it('hands the chat to the seller when a message after the summary changes nothing', () => {
    const shown = complete();
    const decision = decideTurn(
      turn({
        state: 'awaiting_confirmation',
        slots: shown.slots,
        trigger: message(nothing, asked('other')),
      }),
    );
    expect(decision.reply).toEqual({ kind: 'handoff', reason: 'awaiting_seller' });
  });
});

describe('decideTurn: details', () => {
  it('never lets a null overwrite a detail, and lets a value replace one', () => {
    const edited = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({ customerName: 'Rahim' }),
        trigger: message({ ...nothing, customerName: 'Karim' }, asked('edit_order')),
      }),
    );
    expect(edited.slots.customerName).toBe('Karim');
    const kept = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({ customerName: 'Rahim' }),
        trigger: message(nothing),
      }),
    );
    expect(kept.slots.customerName).toBe('Rahim');
  });

  it('stores a valid phone as E.164, Bangla digits included', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        trigger: message({ ...nothing, phone: '০১৮১২-০০০০০০' }, asked('other')),
      }),
    );
    expect(decision.slots.phone).toBe('+8801812000000');
  });

  it('asks for a refused phone again at once, keeping the slot empty', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        trigger: message({ ...nothing, phone: '0181200000' }, asked('other')),
      }),
    );
    expect(decision.slots.phone).toBeUndefined();
    expect(decision.reply).toMatchObject({
      kind: 'ask_slot',
      slot: 'phone',
      reason: 'invalid_phone',
    });
  });

  it('matches the delivery area again when the address changes', () => {
    const decision = decideTurn(
      turn({
        state: 'collecting_details',
        slots: slots({ deliveryAddress: 'Dhanmondi, Dhaka', deliveryChargeId: DHAKA.id }),
        trigger: message(
          { ...nothing, deliveryAddress: 'Zindabazar, Sylhet' },
          asked('edit_order'),
        ),
      }),
    );
    expect(decision.slots.deliveryChargeId).toBe(ELSEWHERE.id);
  });
});

describe('decideTurn: the photo', () => {
  const image = (id: string, url: string) => ({
    id,
    url,
    thumbnailUrl: url,
    position: 0,
    width: 10,
    height: 10,
  });
  const COVER = image('00000000-0000-4000-8000-00000000c001', 'https://cdn.example/lungi.jpg');
  const OWN = image('00000000-0000-4000-8000-00000000c002', 'https://cdn.example/red.jpg');

  it("sends the product's cover when a product is newly matched, and only then", () => {
    const withCover: Product = { ...lungi, images: [COVER], coverImageId: COVER.id };
    const decision = decideTurn(
      turn({
        catalog: { products: [withCover] },
        trigger: message({ ...nothing, items: [said({ productQuery: 'lungi' })] }),
      }),
    );
    expect(decision.image).toBe(COVER.url);
    const again = decideTurn(
      turn({
        state: 'collecting_details',
        slots: decision.slots,
        catalog: { products: [withCover] },
        trigger: message(nothing, asked('other')),
      }),
    );
    expect(again.image).toBeUndefined();
  });

  it("prefers the matched variant's own image", () => {
    const withImages: Product = {
      ...jamdani,
      images: [COVER, OWN],
      coverImageId: COVER.id,
      variants: jamdani.variants.map((variant) =>
        variant.id === RED.id ? { ...variant, imageId: OWN.id } : variant,
      ),
    };
    const decision = decideTurn(
      turn({
        catalog: { products: [withImages] },
        trigger: message({
          ...nothing,
          items: [said({ productQuery: 'jamdani', variantQuery: 'red' })],
        }),
      }),
    );
    expect(decision.image).toBe(OWN.url);
  });
});
