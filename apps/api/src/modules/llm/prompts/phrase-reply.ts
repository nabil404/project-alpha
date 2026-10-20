import type { AssistantTone } from '@app/shared';
import type { ChatLine, PhraseRequest } from '../llm.types';
import { asData, DATA_RULE, transcript } from './transcript';

export const PHRASE_REPLY_SYSTEM = `You write one short Messenger reply on behalf of an online shop.

Rules:
- Do exactly what the instruction says, nothing more.
- Use only the facts given. Never add a price, discount, number, delivery time, stock level, link or promise.
- Reply in the language and script the customer writes in (Bangla, Banglish or English). If that is unclear, use the fallback language.
- One or two short sentences, in the tone given. Output only the reply text.

${DATA_RULE}`;

/** English names, since the prompt is English: `bn` is Bangla. */
const LANGUAGE_NAMES = new Intl.DisplayNames('en', { type: 'language' });

const TONE: Record<AssistantTone, string> = {
  friendly: 'friendly and polite',
  direct: 'short and direct, with no small talk',
  formal: 'formal and respectful',
};

export function phraseReplyPrompt(request: PhraseRequest, history: ChatLine[]): string {
  return [
    `Instruction: ${request.instruction}`,
    `Facts: ${asData(request.facts)}`,
    `Tone: ${TONE[request.tone]}`,
    `Fallback language: ${LANGUAGE_NAMES.of(request.language) ?? request.language}`,
    transcript(history),
  ].join('\n\n');
}
