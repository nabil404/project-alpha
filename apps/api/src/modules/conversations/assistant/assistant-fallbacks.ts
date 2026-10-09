import { formatPhoneInternational, type SlotName } from '@app/shared';
import type { ReplyFacts, ReplyIntent } from './reply-intent';

export type ReplyLanguage = 'bn' | 'en';

type FallbackKey = `ask_${SlotName}` | 'ask_phone_invalid' | 'summary' | 'handoff';

/** The shop's country picks the fallback language: Bangladesh answers in Bangla. */
export function languageFor(country: string): ReplyLanguage {
  return country === 'BD' ? 'bn' : 'en';
}

function summaryLines(
  facts: ReplyFacts,
  labels: Record<'product' | 'qty' | 'name' | 'phone' | 'address', string>,
) {
  const product = [facts.productText, facts.variantText].filter(Boolean).join(', ');
  return [
    `${labels.product}: ${product}`,
    `${labels.qty}: ${facts.quantity ?? ''}`,
    `${labels.name}: ${facts.customerName ?? ''}`,
    `${labels.phone}: ${facts.phone === undefined ? '' : formatPhoneInternational(facts.phone)}`,
    `${labels.address}: ${facts.deliveryAddress ?? ''}`,
  ].join('\n');
}

/**
 * Sent whenever phrasing fails, times out or fails checkReply, and always for
 * a hand-off. The type makes every language carry every sentence.
 */
const FALLBACKS: Record<ReplyLanguage, Record<FallbackKey, (facts: ReplyFacts) => string>> = {
  // Draft: to be reviewed by a Bangla speaker before any pilot.
  bn: {
    ask_product: () => 'আপনি কোন পণ্যটি অর্ডার করতে চান?',
    ask_quantity: () => 'কয়টি নিতে চান?',
    ask_customerName: () => 'অর্ডারের জন্য আপনার নামটি বলবেন?',
    ask_phone: () => 'আপনার মোবাইল নম্বরটি দিন, প্লিজ।',
    ask_phone_invalid: () => 'নম্বরটি সঠিক মনে হচ্ছে না। মোবাইল নম্বরটি আবার দেবেন?',
    ask_deliveryAddress: () => 'ডেলিভারির পুরো ঠিকানাটি দিন, প্লিজ।',
    summary: (facts) =>
      `আপনার অর্ডারটি একবার দেখে নিন:\n${summaryLines(facts, {
        product: 'পণ্য',
        qty: 'পরিমাণ',
        name: 'নাম',
        phone: 'ফোন',
        address: 'ঠিকানা',
      })}\nকিছু বদলাতে চাইলে জানান।`,
    handoff: () => 'ধন্যবাদ! আমাদের একজন প্রতিনিধি শিগগিরই আপনার সাথে কথা বলবেন।',
  },
  en: {
    ask_product: () => 'Which product would you like to order?',
    ask_quantity: () => 'How many would you like?',
    ask_customerName: () => 'What name should we put on the order?',
    ask_phone: () => 'Could you share your mobile number, please?',
    ask_phone_invalid: () =>
      "That number doesn't look right. Could you send your mobile number again?",
    ask_deliveryAddress: () => 'Please share the full delivery address.',
    summary: (facts) =>
      `Please check your order:\n${summaryLines(facts, {
        product: 'Product',
        qty: 'Quantity',
        name: 'Name',
        phone: 'Phone',
        address: 'Address',
      })}\nTell us if anything should change.`,
    handoff: () => 'Thanks! Someone from the shop will reply to you shortly.',
  },
};

export function fallbackText(reply: ReplyIntent, language: ReplyLanguage): string {
  const sentences = FALLBACKS[language];
  switch (reply.kind) {
    case 'ask_slot':
      return reply.slot === 'phone' && reply.invalidPhone
        ? sentences.ask_phone_invalid(reply.facts)
        : sentences[`ask_${reply.slot}`](reply.facts);
    case 'summary':
      return sentences.summary(reply.facts);
    case 'handoff':
      return sentences.handoff({});
  }
}
