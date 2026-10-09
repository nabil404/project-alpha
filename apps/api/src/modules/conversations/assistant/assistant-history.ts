import type { MessageRow } from '../../database/schema/index';
import type { ChatLine } from '../../llm/llm.types';

const FROM = { customer: 'customer', seller: 'shop', assistant: 'assistant' } as const;

/** Oldest first, for the LLM. A reply Messenger refused never reached the customer, so it is left out. */
export function toChatLines(newestFirst: MessageRow[]): ChatLine[] {
  return [...newestFirst]
    .reverse()
    .filter((message) => message.status !== 'failed')
    .map((message) => ({ from: FROM[message.sender], text: message.text }));
}
