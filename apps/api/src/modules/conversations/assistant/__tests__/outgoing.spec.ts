import { outgoingFor } from '../outgoing';
import type { ReplyFacts, ReplyIntent } from '../reply-intent';

const CONVERSATION = '00000000-0000-4000-8000-0000000000c1';
const RED = '00000000-0000-4000-8000-0000000000f1';
const BLUE = '00000000-0000-4000-8000-0000000000f2';
const options = { language: 'en' as const, conversationId: CONVERSATION };

const summary = (names: string[]): ReplyIntent => {
  const facts: ReplyFacts = {
    items: names.map((productName) => ({ productName, quantity: 1, lineTotal: '৳1,000' })),
    customerName: 'Rahim',
    phone: '+8801812000000',
    deliveryAddress: 'Dhanmondi, Dhaka',
    subtotal: '৳1,000',
    deliveryFee: '৳60',
    total: '৳1,060',
  };
  return {
    kind: 'summary',
    facts,
    quote: {
      revision: 7,
      lines: [],
      subtotal: 100_000,
      deliveryChargeId: CONVERSATION,
      deliveryFee: 6_000,
      total: 106_000,
      currency: 'BDT',
    },
  };
};

describe('outgoingFor', () => {
  it('sends a plain ask as text', () => {
    const reply: ReplyIntent = {
      kind: 'ask_slot',
      slot: 'phone',
      intent: 'order',
      facts: { items: [] },
    };
    expect(outgoingFor(reply, 'Your number?', options)).toEqual([
      { text: 'Your number?', content: { kind: 'text' } },
    ]);
  });

  it('carries candidates as quick replies that name them by id', () => {
    const reply: ReplyIntent = {
      kind: 'ask_slot',
      slot: 'variant',
      item: 0,
      intent: 'order',
      choices: [
        { id: RED, title: 'Red' },
        { id: BLUE, title: 'Blue' },
      ],
      facts: { items: [{ productName: 'Jamdani Saree' }] },
    };
    expect(outgoingFor(reply, 'Which colour?', options)).toEqual([
      {
        text: 'Which colour?',
        content: {
          kind: 'quick_replies',
          options: [
            { title: 'Red', payload: `pick:variant:${RED}` },
            { title: 'Blue', payload: `pick:variant:${BLUE}` },
          ],
        },
      },
    ]);
  });

  it('offers the profile name as one quick reply that carries no name', () => {
    const reply: ReplyIntent = {
      kind: 'ask_slot',
      slot: 'customerName',
      intent: 'order',
      offeredName: 'Nusrat Jahan',
      facts: { items: [] },
    };
    expect(outgoingFor(reply, 'Order under Nusrat Jahan?', options)).toEqual([
      {
        text: 'Order under Nusrat Jahan?',
        content: {
          kind: 'quick_replies',
          options: [{ title: 'Nusrat Jahan', payload: 'name:profile' }],
        },
      },
    ]);
  });

  it('sends the summary as one card whose buttons carry its revision', () => {
    const [card, ...rest] = outgoingFor(summary(['Kajal']), 'ignored', options);
    expect(rest).toEqual([]);
    expect(card?.text).toContain('1 × Kajal');
    expect(card?.content).toEqual({
      kind: 'card',
      buttons: [
        { title: 'Confirm', payload: `confirm:${CONVERSATION}:7` },
        { title: 'Change something', payload: `change:${CONVERSATION}:7` },
      ],
    });
  });

  it('sends the item lines first when the card would be too long', () => {
    const names = Array.from(
      { length: 10 },
      (_, n) => `Nakshi Kantha, hand stitched, queen size ${n}`,
    );
    const [items, card] = outgoingFor(summary(names), 'ignored', options);
    expect(items?.content).toEqual({ kind: 'text' });
    expect(items?.text).toContain('queen size 9');
    expect(card?.content.kind).toBe('card');
    expect(card?.text).not.toContain('queen size');
  });

  describe('entry replies', () => {
    const CAT = '00000000-0000-4000-8000-0000000000a1';
    const PRODUCT = '00000000-0000-4000-8000-0000000000b1';

    it('sends categories as browse quick replies', () => {
      const out = outgoingFor(
        {
          kind: 'browse_categories',
          choices: [
            { id: CAT, title: 'Sarees' },
            { id: 'other', title: 'Other' },
          ],
        },
        'What would you like to see?',
        options,
      );
      expect(out).toEqual([
        {
          text: 'What would you like to see?',
          content: {
            kind: 'quick_replies',
            options: [
              { title: 'Sarees', payload: `browse:cat:${CAT}` },
              { title: 'Other', payload: 'browse:cat:other' },
            ],
          },
        },
      ]);
    });

    it('sends plain text when there are no categories to offer', () => {
      expect(outgoingFor({ kind: 'browse_categories', choices: [] }, 'Hi', options)).toEqual([
        { text: 'Hi', content: { kind: 'text' } },
      ]);
    });

    it('sends products as a carousel whose row text names them, then the "more" line', () => {
      const out = outgoingFor(
        {
          kind: 'browse_products',
          cards: [
            {
              id: PRODUCT,
              title: 'Jamdani saree',
              subtitle: 'From ৳4,500',
              imageUrl: 'https://img.test/1.jpg',
            },
          ],
          more: true,
        },
        'Here they are.',
        options,
      );
      expect(out).toEqual([
        {
          text: 'Jamdani saree (From ৳4,500)',
          content: {
            kind: 'carousel',
            cards: [
              {
                title: 'Jamdani saree',
                subtitle: 'From ৳4,500',
                imageUrl: 'https://img.test/1.jpg',
                button: { title: 'Choose', payload: `choose:product:${PRODUCT}` },
              },
            ],
          },
        },
        { text: "Don't see it? Type its name.", content: { kind: 'text' } },
      ]);
    });

    it('sends only the carousel when there is nothing more', () => {
      const out = outgoingFor(
        {
          kind: 'browse_products',
          cards: [{ id: PRODUCT, title: 'Kurti', subtitle: 'From ৳1,600', imageUrl: null }],
          more: false,
        },
        'Here they are.',
        options,
      );
      expect(out).toHaveLength(1);
    });

    it('sends the last-order answer as text', () => {
      expect(outgoingFor({ kind: 'last_order', order: null }, 'None yet.', options)).toEqual([
        { text: 'None yet.', content: { kind: 'text' } },
      ]);
    });
  });
});
