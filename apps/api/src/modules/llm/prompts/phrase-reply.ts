import type { AssistantTone } from '@app/shared';
import type { ChatLine, PhraseRequest } from '../llm.types';
import type { PromptPack } from './prompt-pack';
import { asData, DATA_RULE, transcript } from './transcript';

export const phraseReplySystem = (
  pack: PromptPack,
): string => `You write one short Messenger reply on behalf of an online shop.

Rules:
- Do exactly what the instruction says, nothing more.
- Use only the facts given. Never add a price, discount, number, delivery time, stock level, link or promise.
- When a reply language is given, always reply in it. Otherwise reply in the language and script the customer writes in (${pack.chatLanguages}), and use the fallback language when that is unclear.
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
    `${request.matchCustomer ? 'Fallback language' : 'Reply language'}: ${LANGUAGE_NAMES.of(request.language) ?? request.language}`,
    transcript(history),
  ].join('\n\n');
}
