import type { MessageRow } from '../../database/schema/index';
import type { ChatLine } from '../../llm/llm.types';
import { chatText } from '../message-content';

const FROM = { customer: 'customer', seller: 'shop', assistant: 'assistant' } as const;

/**
 * Oldest first, for the LLM. A reply Messenger refused never reached the
 * customer, and a reaction is not something said, so both are left out. An
 * edited message reads as its latest edit, and one with no words as a tag.
 */
export function toChatLines(newestFirst: MessageRow[]): ChatLine[] {
  return [...newestFirst]
    .reverse()
    .filter((message) => message.status !== 'failed' && message.kind !== 'reaction')
    .map((message) => ({
      from: FROM[message.sender],
      text: message.editedText ?? chatText(message),
    }));
}
