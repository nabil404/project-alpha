import { Logger } from '@nestjs/common';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import { confirmText } from '../assistant-fallbacks';
import { ConversationSimulator, type Step } from './simulator/conversation-simulator';

/**
 * Whole conversations through the worker's code, printed step by step. With
 * the scripted model by default; with the real one when LLM_EVAL=1 and
 * LLM_API_KEY are set, where the script's `llm` answers are ignored:
 * `pnpm --filter api test conversation-simulator` (env loaded).
 */
const SHOP = {
  products: [
    { name: 'Jamdani Saree', colors: ['Red', 'Green'], price: 380_000 },
    { name: 'Katan Saree', aliases: ['katan'], colors: ['Red', 'Maroon'], price: 450_000 },
    { name: 'Kurti', colors: ['Blue', 'Black'], price: 120_000 },
  ],
  areas: [
    { name: 'Dhaka', charge: 6_000 },
    { name: null, charge: 12_000 },
  ],
};

/** "I want the red saree and 2 blue kurtis" through to the card. */
const TO_THE_CARD: Step[] = [
  {
    say: 'I want the red saree and 2 blue kurtis',
    llm: {
      intent: 'order',
      items: [
        {
          productQuery: 'red saree',
          productQueryAlt: 'রেড শাড়ি',
          variantQuery: 'red',
          variantQueryAlt: 'রেড',
        },
        {
          productQuery: 'blue kurtis',
          productQueryAlt: 'ব্লু কুর্তি',
          variantQuery: 'blue',
          variantQueryAlt: 'ব্লু',
          quantity: 2,
        },
      ],
    },
  },
  { quickReply: 'Katan Saree' },
  {
    say: 'just one',
    llm: { intent: 'other', items: [{ ref: 0, quantity: 1 }, { ref: 1 }] },
  },
  { say: 'Rahim Uddin', llm: { intent: 'other', customerName: 'Rahim Uddin' } },
  { say: '01812345678', llm: { intent: 'other', phone: '01812345678' } },
  {
    say: 'House 12, Road 5, Dhanmondi, Dhaka',
    llm: { intent: 'other', deliveryAddress: 'House 12, Road 5, Dhanmondi, Dhaka' },
  },
];

describeDb('conversation simulator', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });
  afterEach(async () => {
    await runtime.close();
    await t.close();
  });

  it('takes a two-item order from the first message to one assistant order', async () => {
    const sim = await ConversationSimulator.open(t, runtime.db, SHOP);
    try {
      const opened = await sim.step(TO_THE_CARD[0]!);
      expect(opened.sends.at(-1)).toMatchObject({ kind: 'quick_replies' });
      expect(
        opened.sends
          .at(-1)
          ?.options.map((option) => option.title)
          .sort(),
      ).toEqual(['Jamdani Saree', 'Katan Saree']);

      const picked = await sim.step(TO_THE_CARD[1]!);
      expect(picked.llmCalls).toEqual([]);
      expect(picked.slots.lastAsked).toMatchObject({ slot: 'quantity', item: 0 });

      let card = picked;
      for (const step of TO_THE_CARD.slice(2)) card = await sim.step(step);

      const sentCard = card.sends.find((sent) => sent.kind === 'card');
      expect(card.state).toBe('awaiting_confirmation');
      expect(card.slots.quote).toMatchObject({
        subtotal: 450_000 + 2 * 120_000,
        deliveryFee: 6_000,
        total: 696_000,
        currency: 'BDT',
      });
      expect(sentCard?.text).toContain('1 × Katan Saree, Red  ৪,৫০০৳');
      expect(sentCard?.text).toContain('ডেলিভারি চার্জ (Dhaka): ৬০৳');
      expect(sentCard?.text).toContain('সর্বমোট: ৬,৯৬০৳');
      const revision = card.slots.revision;
      expect(sentCard?.options.map((option) => option.payload)).toEqual([
        expect.stringMatching(new RegExp(`^confirm:.+:${revision}$`)),
        expect.stringMatching(new RegExp(`^change:.+:${revision}$`)),
      ]);

      const confirmed = await sim.step({ button: 'confirm' });
      expect(confirmed.ordersCreated).toHaveLength(1);
      const [order] = confirmed.ordersCreated;
      expect(order).toMatchObject({ source: 'assistant', total: 696_000 });
      expect(order!.lines).toEqual(
        expect.arrayContaining([
          { variantId: sim.variantId('Katan Saree / Red'), quantity: 1, unitPrice: 450_000 },
          { variantId: sim.variantId('Kurti / Blue'), quantity: 2, unitPrice: 120_000 },
        ]),
      );
      const reference = confirmText({ kind: 'reference', reference: order!.reference }, 'bn');
      expect(confirmed.sends.map((sent) => sent.text)).toEqual([reference]);
      expect(confirmed.state).toBe('confirmed');

      const again = await sim.step({ button: 'confirm' });
      expect(again.sends.map((sent) => sent.text)).toEqual([reference]);
      expect(again.ordersCreated).toEqual([]);
      expect(await sim.orders()).toHaveLength(1);
      // One email: the replay's call reuses the order's job id.
      expect(new Set(sim.drafted).size).toBe(1);
    } finally {
      sim.print('golden path: two items, a pick, details, Confirm twice');
    }
  }, 60_000);

  it('switches a picked Katan Saree to the Jamdani for "not katan, jamdani"', async () => {
    const sim = await ConversationSimulator.open(t, runtime.db, SHOP);
    try {
      for (const step of TO_THE_CARD) await sim.step(step);

      let switched = await sim.step({
        say: 'not katan, jamdani',
        llm: {
          intent: 'edit_order',
          items: [{ ref: 0, productQuery: 'not katan, jamdani', variantQuery: 'red' }, { ref: 1 }],
        },
      });
      const offered = switched.sends.at(-1);
      if (offered?.kind === 'quick_replies') {
        expect(offered.options.map((option) => option.title)).toContain('Jamdani Saree');
        switched = await sim.step({ quickReply: 'Jamdani Saree' });
      }

      const card = switched.sends.find((sent) => sent.kind === 'card');
      expect(switched.state).toBe('awaiting_confirmation');
      expect(card?.text).toContain('Jamdani Saree');
      expect(card?.text).not.toContain('Katan Saree');
      expect(switched.slots.items[0]).toMatchObject({
        variantId: sim.variantId('Jamdani Saree / Red'),
      });
    } finally {
      sim.print('switch after the card: "not katan, jamdani"');
    }
  }, 60_000);

  it('sends a new card for "make the saree 3" and refuses the old one', async () => {
    const sim = await ConversationSimulator.open(t, runtime.db, SHOP);
    try {
      for (const step of TO_THE_CARD) await sim.step(step);

      const edited = await sim.step({
        say: 'make the saree 3',
        llm: {
          intent: 'edit_order',
          items: [{ ref: 0, productQuery: 'saree', quantity: 3 }, { ref: 1 }],
        },
      });
      expect(edited.sends.map((sent) => sent.kind)).toEqual(['card']);
      expect(edited.slots.quote).toMatchObject({
        subtotal: 3 * 450_000 + 2 * 120_000,
        total: 3 * 450_000 + 2 * 120_000 + 6_000,
      });

      const old = await sim.step({ button: 'confirm', card: 0 });
      expect(old.sends.map((sent) => sent.text)).toEqual([confirmText({ kind: 'stale' }, 'bn')]);
      expect(old.ordersCreated).toEqual([]);

      const current = await sim.step({ button: 'confirm', card: 1 });
      expect(current.ordersCreated).toHaveLength(1);
      expect(current.ordersCreated[0]!.lines).toEqual(
        expect.arrayContaining([
          { variantId: sim.variantId('Katan Saree / Red'), quantity: 3, unitPrice: 450_000 },
        ]),
      );
    } finally {
      sim.print('edit after the card: "make the saree 3", then the old card');
    }
  }, 60_000);
});
