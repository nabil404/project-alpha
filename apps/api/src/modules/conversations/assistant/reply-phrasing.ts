import { formatPhoneInternational, type SlotName } from '@app/shared';
import type { PhraseRequest } from '../../llm/llm.types';
import type { ReplyLanguage } from './assistant-fallbacks';
import type { ReplyFacts, ReplyIntent } from './reply-intent';

const ASK: Record<SlotName, string> = {
  product: 'Ask which product the customer would like to order.',
  quantity: 'Ask how many they would like.',
  customerName: 'Ask for the name to put on the order.',
  phone: 'Ask for their mobile number.',
  deliveryAddress: 'Ask for the full delivery address.',
};

/** The facts as the phrasing call sees them; the phone in its readable international form. */
function factValues(facts: ReplyFacts): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value === undefined) continue;
    values[key] = key === 'phone' ? formatPhoneInternational(String(value)) : value;
  }
  return values;
}

/** What code decided, as an instruction. Hand-offs are never phrased. */
export function phraseRequestFor(
  reply: Exclude<ReplyIntent, { kind: 'handoff' }>,
  language: ReplyLanguage,
): PhraseRequest {
  if (reply.kind === 'summary') {
    return {
      instruction:
        'Summarise the order using every fact, then ask the customer to check it and say if anything should change.',
      facts: factValues(reply.facts),
      language,
    };
  }
  const parts = [
    reply.intent === 'browse' || reply.intent === 'other'
      ? 'Briefly acknowledge their last message first.'
      : '',
    reply.slot === 'phone' && reply.invalidPhone
      ? 'Say the phone number they gave looks incomplete or wrong, and ask for it again.'
      : ASK[reply.slot],
  ];
  return { instruction: parts.filter(Boolean).join(' '), facts: factValues(reply.facts), language };
}
