import type { SlotName } from '@app/shared';
import type { AskReason, ReplyFacts, ReplyIntent } from './reply-intent';
import { summaryMessages } from './summary-card';

export type ReplyLanguage = 'bn' | 'en';

type FallbackKey =
  | `ask_${SlotName}`
  | 'ask_phone_invalid'
  | 'ask_product_not_found'
  | 'ask_product_choose'
  | 'ask_product_out_of_stock'
  | 'ask_variant_not_found'
  | 'ask_variant_choose'
  | 'ask_variant_out_of_stock'
  | 'ask_quantity_too_many'
  | 'handoff'
  | 'handoff_awaiting_seller';

/** The BCP-47 locale each reply language formats money in. */
export const LOCALES: Record<ReplyLanguage, string> = { bn: 'bn-BD', en: 'en-US' };

/** The shop's country picks the fallback language: Bangladesh answers in Bangla. */
export function languageFor(country: string): ReplyLanguage {
  return country === 'BD' ? 'bn' : 'en';
}

/** The customer's side of a standalone referral, stored as their message. Draft Bangla, to be reviewed. */
export const REFERRAL_TEXT: Record<ReplyLanguage, { link: string; ad: string }> = {
  bn: { link: 'একটি পণ্যের লিংক থেকে এসেছেন', ad: 'একটি বিজ্ঞাপন থেকে এসেছেন' },
  en: { link: 'Opened a link to a product', ad: 'Came from an ad' },
};

/** The facts, and the item the slot is asked for. */
interface Asked {
  facts: ReplyFacts;
  item: number | undefined;
}

const nameOf = ({ facts, item }: Asked) =>
  item === undefined ? '' : (facts.items[item]?.productName ?? '');
const availableOf = ({ facts, item }: Asked) =>
  item === undefined ? 0 : (facts.items[item]?.available ?? 0);

/**
 * Sent whenever phrasing fails, times out or fails checkReply, and always for
 * a hand-off. The type makes every language carry every sentence.
 */
const FALLBACKS: Record<ReplyLanguage, Record<FallbackKey, (asked: Asked) => string>> = {
  // Draft: to be reviewed by a Bangla speaker before any pilot.
  bn: {
    ask_product: () => 'আপনি কোন পণ্যটি অর্ডার করতে চান?',
    ask_product_not_found: () => 'দুঃখিত, পণ্যটি খুঁজে পাইনি। পণ্যের নামটি আরেকবার লিখবেন?',
    ask_product_choose: () => 'আপনি কোনটির কথা বলছেন?',
    ask_product_out_of_stock: (asked) =>
      `দুঃখিত, ${asked.facts.unavailable ?? 'পণ্যটি'} এখন স্টকে নেই। অন্য কোনো পণ্য নেবেন?`,
    ask_variant: (asked) => `${nameOf(asked)} - কোনটি নেবেন?`,
    ask_variant_not_found: (asked) => `${nameOf(asked)} - এগুলোর মধ্যে কোনটি নেবেন?`,
    ask_variant_choose: (asked) => `${nameOf(asked)} - কোনটি নেবেন?`,
    ask_variant_out_of_stock: (asked) =>
      `দুঃখিত, ${asked.facts.unavailable ?? 'এটি'} এখন স্টকে নেই। অন্য কোনটি নেবেন?`,
    ask_quantity: (asked) => `${nameOf(asked)} কয়টি নিতে চান?`,
    ask_quantity_too_many: (asked) =>
      `দুঃখিত, ${nameOf(asked)} এখন ${availableOf(asked)}টি আছে। কয়টি নেবেন?`,
    ask_customerName: () => 'অর্ডারের জন্য আপনার নামটি বলবেন?',
    ask_phone: () => 'আপনার মোবাইল নম্বরটি দিন, প্লিজ।',
    ask_phone_invalid: () => 'নম্বরটি সঠিক মনে হচ্ছে না। মোবাইল নম্বরটি আবার দেবেন?',
    ask_deliveryAddress: () => 'ডেলিভারির পুরো ঠিকানাটি (এলাকা ও জেলাসহ) দিন, প্লিজ।',
    handoff: () => 'ধন্যবাদ! আমাদের একজন প্রতিনিধি শিগগিরই আপনার সাথে কথা বলবেন।',
    handoff_awaiting_seller: () => 'ধন্যবাদ! আপনার অর্ডারটি দোকান শিগগিরই নিশ্চিত করবে।',
  },
  en: {
    ask_product: () => 'Which product would you like to order?',
    ask_product_not_found: () =>
      "Sorry, I couldn't find that product. Could you write its name again?",
    ask_product_choose: () => 'Which of these do you mean?',
    ask_product_out_of_stock: (asked) =>
      `Sorry, ${asked.facts.unavailable ?? 'that product'} is out of stock right now. Would you like something else?`,
    ask_variant: (asked) => `Which ${nameOf(asked)} would you like?`,
    ask_variant_not_found: (asked) =>
      `We have these ${nameOf(asked)} options. Which one would you like?`,
    ask_variant_choose: (asked) => `Which ${nameOf(asked)} would you like?`,
    ask_variant_out_of_stock: (asked) =>
      `Sorry, ${asked.facts.unavailable ?? 'that one'} is out of stock right now. Which other one would you like?`,
    ask_quantity: (asked) => `How many ${nameOf(asked)} would you like?`,
    ask_quantity_too_many: (asked) =>
      `Sorry, we have only ${availableOf(asked)} ${nameOf(asked)} right now. How many would you like?`,
    ask_customerName: () => 'What name should we put on the order?',
    ask_phone: () => 'Could you share your mobile number, please?',
    ask_phone_invalid: () =>
      "That number doesn't look right. Could you send your mobile number again?",
    ask_deliveryAddress: () =>
      'Please share the full delivery address, with the area and district.',
    handoff: () => 'Thanks! Someone from the shop will reply to you shortly.',
    handoff_awaiting_seller: () => 'Thanks! The shop will confirm your order shortly.',
  },
};

const REASON_KEYS: Partial<Record<`${SlotName}:${AskReason}`, FallbackKey>> = {
  'phone:invalid_phone': 'ask_phone_invalid',
  'product:not_found': 'ask_product_not_found',
  'product:choose': 'ask_product_choose',
  'product:product_out_of_stock': 'ask_product_out_of_stock',
  'variant:not_found': 'ask_variant_not_found',
  'variant:choose': 'ask_variant_choose',
  'variant:out_of_stock': 'ask_variant_out_of_stock',
  'quantity:too_many': 'ask_quantity_too_many',
};

export function fallbackText(reply: ReplyIntent, language: ReplyLanguage): string {
  const sentences = FALLBACKS[language];
  switch (reply.kind) {
    case 'ask_slot': {
      const reasoned = reply.reason && REASON_KEYS[`${reply.slot}:${reply.reason}`];
      const key: FallbackKey = reasoned || `ask_${reply.slot}`;
      return sentences[key]({ facts: reply.facts, item: reply.item });
    }
    case 'summary': {
      const { items, card } = summaryMessages(reply.facts, language);
      return items === null ? card : `${items}\n\n${card}`;
    }
    case 'handoff': {
      const say =
        reply.reason === 'awaiting_seller' ? sentences.handoff_awaiting_seller : sentences.handoff;
      return say({ facts: { items: [] }, item: undefined });
    }
    // Task 7 stopgap: the entry replies have no fallback text yet.
    default:
      return sentences.handoff({ facts: { items: [] }, item: undefined });
  }
}

/** The Confirm path's replies (P10): fixed sentences, never phrased. */
export type ConfirmSentence =
  | { kind: 'reference'; reference: string }
  | { kind: 'stale' }
  | { kind: 'unavailable'; name: string }
  | { kind: 'price_changed' }
  | { kind: 'change' };

const CONFIRM_SENTENCES: Record<ReplyLanguage, (sentence: ConfirmSentence) => string> = {
  // Draft: to be reviewed by a Bangla speaker before any pilot.
  bn: (sentence) => {
    switch (sentence.kind) {
      case 'reference':
        return `ধন্যবাদ! আপনার অর্ডারটি নেওয়া হয়েছে। অর্ডার নম্বর: ${sentence.reference}। দোকান শিগগিরই যোগাযোগ করবে।`;
      case 'stale':
        return 'এই সারাংশটি পুরনো হয়ে গেছে। সর্বশেষ সারাংশের বোতামটি চাপুন, প্লিজ।';
      case 'unavailable':
        return `দুঃখিত, ${sentence.name} এখন আর পাওয়া যাচ্ছে না, তাই অর্ডারটি নেওয়া হয়নি। এর বদলে কোনটি নেবেন?`;
      case 'price_changed':
        return 'দাম বদলে গেছে, তাই অর্ডারটি নেওয়া হয়নি। নতুন হিসাবটি দেখে নিন:';
      case 'change':
        return 'ঠিক আছে, কী বদলাতে চান?';
    }
  },
  en: (sentence) => {
    switch (sentence.kind) {
      case 'reference':
        return `Thank you! Your order is placed. Your order number is ${sentence.reference}. The shop will be in touch soon.`;
      case 'stale':
        return 'That summary is out of date. Please use the buttons on the latest one.';
      case 'unavailable':
        return `Sorry, ${sentence.name} is no longer available, so the order was not placed. What would you like instead?`;
      case 'price_changed':
        return 'The price changed, so the order was not placed. Here is the updated order:';
      case 'change':
        return 'Sure, what would you like to change?';
    }
  },
};

export function confirmText(sentence: ConfirmSentence, language: ReplyLanguage): string {
  return CONFIRM_SENTENCES[language](sentence);
}
