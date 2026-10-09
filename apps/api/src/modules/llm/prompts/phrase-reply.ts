import type { ChatLine, PhraseRequest } from '../llm.types';
import { asData, DATA_RULE, transcript } from './transcript';

export const PHRASE_REPLY_SYSTEM = `You write one short Messenger reply on behalf of an online shop.

Rules:
- Do exactly what the instruction says, nothing more.
- Use only the facts given. Never add a price, discount, number, delivery time, stock level, link or promise.
- Reply in the language and script the customer writes in (Bangla, Banglish or English). If that is unclear, use the fallback language.
- One or two short, friendly sentences. Output only the reply text.

${DATA_RULE}`;

const LANGUAGE_NAME = { bn: 'Bangla', en: 'English' } as const;

export function phraseReplyPrompt(request: PhraseRequest, history: ChatLine[]): string {
  return [
    `Instruction: ${request.instruction}`,
    `Facts: ${asData(request.facts)}`,
    `Fallback language: ${LANGUAGE_NAME[request.language]}`,
    transcript(history),
  ].join('\n\n');
}
