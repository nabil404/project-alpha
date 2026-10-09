import { slotNames } from '@app/shared';
import { fallbackText, languageFor, type ReplyLanguage } from '../assistant-fallbacks';
import type { ReplyIntent } from '../reply-intent';

const facts = {
  productText: 'red saree',
  variantText: 'XL',
  quantity: 2,
  customerName: 'Rahim',
  phone: '+8801812000000',
  deliveryAddress: 'House 12, Road 5, Dhanmondi',
};

const replies: ReplyIntent[] = [
  ...slotNames.map((slot): ReplyIntent => ({
    kind: 'ask_slot',
    slot,
    intent: 'order',
    invalidPhone: false,
    facts: {},
  })),
  { kind: 'ask_slot', slot: 'phone', intent: 'other', invalidPhone: true, facts: {} },
  { kind: 'summary', facts },
  { kind: 'handoff', reason: 'llm_failed' },
  { kind: 'handoff', reason: 'awaiting_seller' },
];

describe('languageFor', () => {
  it('answers Bangladeshi shops in Bangla and every other shop in English', () => {
    expect(languageFor('BD')).toBe('bn');
    expect(languageFor('IN')).toBe('en');
    expect(languageFor('GB')).toBe('en');
  });
});

describe('fallbackText', () => {
  it.each(
    (['bn', 'en'] as ReplyLanguage[]).flatMap((language) =>
      replies.map((reply) => [language, reply] as const),
    ),
  )('%s has a sentence for %j', (language, reply) => {
    expect(fallbackText(reply, language).trim().length).toBeGreaterThan(0);
  });

  it('words an invalid phone differently from a first ask', () => {
    const first: ReplyIntent = {
      kind: 'ask_slot',
      slot: 'phone',
      intent: 'order',
      invalidPhone: false,
      facts: {},
    };
    expect(fallbackText({ ...first, invalidPhone: true }, 'en')).not.toBe(
      fallbackText(first, 'en'),
    );
  });

  it('words the awaiting_seller hand-off as its own sentence', () => {
    const generic: ReplyIntent = { kind: 'handoff', reason: 'llm_failed' };
    const seller: ReplyIntent = { kind: 'handoff', reason: 'awaiting_seller' };
    expect(fallbackText(seller, 'en')).toBe('Thanks! The shop will confirm your order shortly.');
    expect(fallbackText(seller, 'bn')).toBe('ধন্যবাদ! আপনার অর্ডারটি দোকান শিগগিরই নিশ্চিত করবে।');
    expect(fallbackText(seller, 'en')).not.toBe(fallbackText(generic, 'en'));
  });

  it('fills the summary from the facts only', () => {
    const text = fallbackText({ kind: 'summary', facts }, 'en');
    for (const part of [
      'red saree',
      'XL',
      '2',
      'Rahim',
      '+880 1812 000000',
      'House 12, Road 5, Dhanmondi',
    ]) {
      expect(text).toContain(part);
    }
  });
});
