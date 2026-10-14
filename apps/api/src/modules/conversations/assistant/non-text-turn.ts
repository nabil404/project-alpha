import type { CollectedSlots, MessageKind } from '@app/shared';
import { isEmojiOnly, type MessageDetails } from '../message-content';
import { handOff, type ActiveState, type TurnDecision } from './conversation-machine';
import type { Notice } from './reply-intent';

/** Files the assistant cannot read. A photo is read from phase 6; until then the seller looks. */
const UNREADABLE: ReadonlySet<MessageKind> = new Set(['video', 'audio', 'file', 'other']);

/** Reactions that read as a yes: the ones a customer might mean as "confirm". */
const AFFIRMING_LABELS = new Set(['like', 'love']);
const AFFIRMING_EMOJI = /^(?:👍|❤|♥|😍|🥰|👌)/u;

export interface NonTextTrigger {
  kind: MessageKind;
  /** The text the turn reads: the customer's latest edit, else what they sent. */
  text: string;
  details: MessageDetails;
}

/**
 * The turn for a message without words, decided by code with no LLM call.
 * Null for words, which the LLM reads; `silent` for a reaction that asks
 * nothing. None of these can confirm an order: on the summary card each one
 * points to its Confirm button and leaves the state as it was.
 */
export function decideNonText({
  state,
  slots,
  trigger,
  previousKind,
}: {
  state: ActiveState;
  slots: CollectedSlots;
  trigger: NonTextTrigger;
  /** The kind of the customer's message before the trigger, reactions aside. */
  previousKind: MessageKind | null;
}): TurnDecision | 'silent' | null {
  if (trigger.kind === 'text' && !isEmojiOnly(trigger.text)) return null;
  const say = (notice: Notice): TurnDecision => ({
    state,
    slots,
    reply: { kind: 'notice', notice },
  });

  if (trigger.kind === 'reaction') {
    return state === 'awaiting_confirmation' && affirming(trigger.details)
      ? say('use_confirm')
      : 'silent';
  }
  if (state === 'awaiting_confirmation') return say('use_confirm');
  switch (trigger.kind) {
    case 'text':
    case 'sticker':
      return say('type_please');
    case 'location':
      return say(slots.deliveryAddress === undefined ? 'location_write_address' : 'location_seen');
    case 'image':
      return handOff(slots, 'unreadable');
    default:
      // A second file in a row after "text only" means they need a person.
      return previousKind !== null && UNREADABLE.has(previousKind)
        ? handOff(slots, 'unreadable')
        : say('text_only');
  }
}

function affirming(details: MessageDetails): boolean {
  const reaction = details.reaction;
  if (!reaction) return false;
  return AFFIRMING_LABELS.has(reaction.label) || AFFIRMING_EMOJI.test(reaction.emoji);
}
