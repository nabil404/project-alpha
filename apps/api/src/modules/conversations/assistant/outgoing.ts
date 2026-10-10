import { encodePayload } from '@app/shared';
import type { OutboundContent } from '../outbound-message.sender';
import type { ReplyLanguage } from './assistant-fallbacks';
import type { ReplyIntent } from './reply-intent';
import { summaryMessages } from './summary-card';

/** One message the turn sends: the row's text and how it goes out. */
export interface Outgoing {
  text: string;
  content: OutboundContent;
}

/**
 * The turn's reply as Messenger messages. An ask with candidates carries them
 * as quick replies whose payload names the candidate; a summary is the card
 * with Confirm and Change buttons for its revision, after its item lines when
 * the card alone would be too long. `notice` puts a fixed line before the
 * summary.
 */
export function outgoingFor(
  reply: ReplyIntent,
  text: string,
  {
    language,
    conversationId,
    notice,
  }: {
    language: ReplyLanguage;
    conversationId: string;
    notice?: string;
  },
): Outgoing[] {
  if (reply.kind === 'summary') {
    const { items, card, buttons } = summaryMessages(reply.facts, language, notice);
    const revision = reply.quote.revision;
    const cardMessage: Outgoing = {
      text: card,
      content: {
        kind: 'card',
        buttons: [
          {
            title: buttons.confirm,
            payload: encodePayload({ kind: 'confirm', conversationId, revision }),
          },
          {
            title: buttons.change,
            payload: encodePayload({ kind: 'change', conversationId, revision }),
          },
        ],
      },
    };
    return items === null
      ? [cardMessage]
      : [{ text: items, content: { kind: 'text' } }, cardMessage];
  }
  if (reply.kind === 'ask_slot' && reply.choices && reply.choices.length > 0) {
    const slot = reply.slot === 'variant' ? 'variant' : 'product';
    return [
      {
        text,
        content: {
          kind: 'quick_replies',
          options: reply.choices.map((choice) => ({
            title: choice.title,
            payload: encodePayload({ kind: 'pick', slot, id: choice.id }),
          })),
        },
      },
    ];
  }
  return [{ text, content: { kind: 'text' } }];
}
