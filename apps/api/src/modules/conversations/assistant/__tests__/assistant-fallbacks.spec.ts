import { slotNames, type SlotName } from '@app/shared';
import {
  confirmText,
  fallbackText,
  languageFor,
  type ConfirmSentence,
  type ReplyLanguage,
} from '../assistant-fallbacks';
import type { AskReason, ReplyFacts, ReplyIntent } from '../reply-intent';

const facts: ReplyFacts = {
  items: [{ productName: 'Check Lungi', available: 3 }],
  unavailable: '42 / Black',
};
const ask = (slot: SlotName, reason?: AskReason): ReplyIntent => ({
  kind: 'ask_slot',
  slot,
  item: 0,
  intent: 'order',
  ...(reason ? { reason } : {}),
  facts,
});

const replies: ReplyIntent[] = [
  ...slotNames.map((slot) => ask(slot)),
  ask('phone', 'invalid_phone'),
  ask('product', 'not_found'),
  ask('product', 'choose'),
  ask('product', 'product_out_of_stock'),
  ask('variant', 'not_found'),
  ask('variant', 'choose'),
  ask('variant', 'out_of_stock'),
  ask('quantity', 'too_many'),
  { kind: 'handoff', reason: 'llm_failed' },
  { kind: 'handoff', reason: 'awaiting_seller' },
];
const languages: ReplyLanguage[] = ['bn', 'en'];

describe('languageFor', () => {
  it('answers Bangladeshi shops in Bangla and every other shop in English', () => {
    expect(languageFor('BD')).toBe('bn');
    expect(languageFor('IN')).toBe('en');
  });
});

describe('fallbackText', () => {
  it.each(languages.flatMap((language) => replies.map((reply) => [language, reply] as const)))(
    '%s has a sentence for %j',
    (language, reply) => {
      expect(fallbackText(reply, language).trim().length).toBeGreaterThan(0);
    },
  );

  it('words each reason differently from the plain ask', () => {
    for (const [slot, reason] of [
      ['phone', 'invalid_phone'],
      ['product', 'not_found'],
      ['variant', 'out_of_stock'],
      ['quantity', 'too_many'],
    ] as const) {
      expect(fallbackText(ask(slot, reason), 'en')).not.toBe(fallbackText(ask(slot), 'en'));
    }
  });

  it('names the item, what ran out, and how many are left', () => {
    expect(fallbackText(ask('quantity'), 'en')).toBe('How many Check Lungi would you like?');
    expect(fallbackText(ask('variant', 'out_of_stock'), 'en')).toContain('42 / Black');
    expect(fallbackText(ask('quantity', 'too_many'), 'en')).toContain('only 3 Check Lungi');
  });

  it('words the awaiting_seller hand-off as its own sentence', () => {
    const seller: ReplyIntent = { kind: 'handoff', reason: 'awaiting_seller' };
    expect(fallbackText(seller, 'en')).toBe('Thanks! The shop will confirm your order shortly.');
    expect(fallbackText(seller, 'en')).not.toBe(
      fallbackText({ kind: 'handoff', reason: 'llm_failed' }, 'en'),
    );
  });
});

describe('confirmText', () => {
  const sentences: ConfirmSentence[] = [
    { kind: 'reference', reference: 'ORD-2026-00481' },
    { kind: 'stale' },
    { kind: 'unavailable', name: 'Check Lungi' },
    { kind: 'price_changed' },
    { kind: 'change' },
  ];

  it.each(languages.flatMap((language) => sentences.map((s) => [language, s] as const)))(
    '%s has a sentence for %j',
    (language, sentence) => {
      expect(confirmText(sentence, language).trim().length).toBeGreaterThan(0);
    },
  );

  it('carries the order reference and the unavailable item', () => {
    for (const language of languages) {
      expect(confirmText(sentences[0]!, language)).toContain('ORD-2026-00481');
      expect(confirmText(sentences[2]!, language)).toContain('Check Lungi');
    }
  });

  it.each(['bn', 'en'] as const)('words every entry reply in %s', (language) => {
    expect(fallbackText({ kind: 'browse_categories', choices: [] }, language)).not.toBe('');
    expect(fallbackText({ kind: 'browse_products', cards: [], more: false }, language)).not.toBe(
      '',
    );
    expect(fallbackText({ kind: 'last_order', order: null }, language)).not.toBe('');
    expect(
      fallbackText(
        { kind: 'last_order', order: { reference: 'ORD-1', status: 'packed', total: '৳10' } },
        language,
      ),
    ).toContain('ORD-1');
  });
});
