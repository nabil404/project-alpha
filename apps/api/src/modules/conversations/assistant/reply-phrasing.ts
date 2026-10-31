import {
  formatPhoneInternational,
  MATCH_CUSTOMER,
  type AssistantSettings,
  type SlotName,
} from '@app/shared';
import type { PhraseRequest } from '../../llm/llm.types';
import type { PromptPack } from '../../llm/prompts/prompt-pack';
import type { AskReason, ReplyFacts, ReplyIntent } from './reply-intent';

const ASK: Record<SlotName, string> = {
  product: 'Ask which product the customer would like to order.',
  variant:
    'Ask which option (colour, size) of {item} they would like; the options are shown as buttons under your message.',
  quantity: 'Ask how many of {item} they would like.',
  customerName: 'Ask for the name to put on the order.',
  phone: 'Ask for their mobile number.',
  deliveryAddress: 'Ask for the full delivery address, with the area and district.',
};

const BECAUSE: Record<AskReason, string> = {
  invalid_phone: 'Say the phone number they gave looks incomplete or wrong, and ask for it again.',
  not_found:
    'Say the shop could not find what they asked for, and ask them to name it again. Do not suggest products.',
  choose:
    'Say there are a few close matches, shown as buttons under your message, and ask which one they mean.',
  unavailable: 'Say "{unavailable}" is no longer available and ask what they would like instead.',
  out_of_stock:
    'Say "{unavailable}" is out of stock, and ask which other option of {item} they would like; the in-stock options are shown as buttons.',
  product_out_of_stock:
    'Say "{unavailable}" is out of stock, and ask if they would like another product.',
  too_many:
    'Say only the available number of {item} is in stock, and ask how many they would like.',
  // A shared post's ask is a fixed line today; these keep the record whole.
  shared_post:
    'Ask whether they mean the product shown as a button under your message, from the post they shared.',
  shared_post_unknown:
    'Say you could not open the post they shared, and ask them to type the name of the product.',
  // A photo's asks are fixed lines too.
  photo: 'Ask whether the product shown under your message is the one in their photo.',
  photo_unknown:
    'Say you could not tell which product is in their photo, and ask them to type its name.',
  photo_unreadable: 'Say you could not open their photo, and ask them to type the product name.',
  photo_rejected: 'Ask them to type the name of the product they are looking for.',
};

/** The facts as the phrasing call sees them; the phone in its readable international form. */
function factValues(facts: ReplyFacts): Record<string, unknown> {
  return facts.phone === undefined
    ? { ...facts }
    : { ...facts, phone: formatPhoneInternational(facts.phone) };
}

/** How a phrased reply sounds: the seller's tone, and their default language over the region's. */
export function phraseVoice(
  settings: Pick<AssistantSettings, 'tone' | 'defaultLanguage'>,
  pack: PromptPack,
): Pick<PhraseRequest, 'language' | 'tone' | 'pack'> {
  const language =
    settings.defaultLanguage === MATCH_CUSTOMER ? pack.replyLanguage : settings.defaultLanguage;
  return { language, tone: settings.tone, pack };
}

/** What code decided, as an instruction. Hand-offs and the summary card are never phrased. */
export function phraseRequestFor(
  reply: Extract<ReplyIntent, { kind: 'ask_slot' }>,
  voice: Pick<PhraseRequest, 'language' | 'tone' | 'pack'>,
): PhraseRequest {
  // The item by name, never by number: a number the facts lack would fail checkReply.
  const item =
    reply.item === undefined ? '' : `"${reply.facts.items[reply.item]?.productName ?? ''}"`;
  const parts = [
    reply.intent === 'browse' || reply.intent === 'other'
      ? 'Briefly acknowledge their last message first.'
      : '',
    reply.reason === undefined ? ASK[reply.slot] : BECAUSE[reply.reason],
  ];
  const instruction = parts
    .filter(Boolean)
    .join(' ')
    .replaceAll('{item}', item)
    .replaceAll('{unavailable}', reply.facts.unavailable ?? '');
  return { instruction, facts: factValues(reply.facts), ...voice };
}
