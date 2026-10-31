import type { ChoiceQuestion } from '@typesafe-ai/sdk';
import type { CustomerIntent } from '@app/shared';
import type { ChatLine } from '../llm.types';
import type { PromptPack } from './prompt-pack';

/**
 * Jev's state for intent: the customer's newest messages apart from the chat
 * before them, so the question names exactly what to classify. The assistant
 * speaks for the shop, so both are `shop` here.
 */
export function classifyIntentState(history: ChatLine[], pack: PromptPack) {
  const lines = history.map((line) => ({
    from: line.from === 'customer' ? ('customer' as const) : ('shop' as const),
    text: line.text,
  }));
  const lastShop = lines.findLastIndex((line) => line.from === 'shop');
  const earlier = lines.slice(0, lastShop + 1);
  const latest = lines.slice(lastShop + 1).map((line) => line.text);
  return {
    chat_languages: pack.chatLanguages,
    // An empty list reads as a signal, so a first message has no earlier chat at all.
    ...(earlier.length > 0 ? { earlier_chat: earlier } : {}),
    latest_customer_messages: latest,
  };
}

/** One option per intent, in `customerIntentSchema`'s terms. */
export const CLASSIFY_INTENT_QUESTION = {
  type: 'choice',
  instructions:
    'What does the customer want from the online shop in `latest_customer_messages`? The messages are in `chat_languages`.',
  criteria: {
    browse: 'Looking around or asking what the shop sells, without choosing anything.',
    order:
      "Wants to buy something, or answers the shop's question while an order is in progress with a product, quantity, name, phone number or address.",
    ask_question:
      'Asks something the shop must answer, such as delivery areas, payment, price, size or timing.',
    edit_order: 'Changes a detail of an order already in progress: quantity, address or product.',
    complain: 'Unhappy about an order, a delivery, the product or the service.',
    request_human: 'Asks for a person, the owner or a phone call.',
    other: 'A greeting, thanks, an acknowledgement or anything else.',
  },
} as const satisfies ChoiceQuestion<Record<CustomerIntent, string>>;
