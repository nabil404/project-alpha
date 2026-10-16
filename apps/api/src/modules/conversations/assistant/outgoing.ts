import { encodePayload } from '@app/shared';
import type { OutboundContent } from '../outbound-message.sender';
import { ENTRY_TEXT, PHOTO_BUTTONS, type ReplyLanguage } from './assistant-fallbacks';
import type { ReplyIntent } from './reply-intent';
import { summaryMessages } from './summary-card';

/** One message the turn sends: the row's text and how it goes out. */
export interface Outgoing {
  text: string;
  content: OutboundContent;
}

/**
 * The turn's reply as Messenger messages. An ask with candidates carries them
 * as quick replies whose payload names the candidate; a photo's one match is
 * Yes and No instead, and its several are a carousel. An ask for the
 * name offers the profile name as one; a summary is the card
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
  if (reply.kind === 'browse_categories' && reply.choices.length > 0) {
    return [
      {
        text,
        content: {
          kind: 'quick_replies',
          options: reply.choices.map((choice) => ({
            title: choice.title,
            payload: encodePayload({ kind: 'browse', categoryId: choice.id }),
          })),
        },
      },
    ];
  }
  if (reply.kind === 'browse_products') {
    const carousel: Outgoing = {
      // The dashboard thread shows the row's text; it names what the customer saw.
      text: reply.cards.map((card) => `${card.title} (${card.subtitle})`).join(', '),
      content: {
        kind: 'carousel',
        cards: reply.cards.map((card) => ({
          title: card.title,
          subtitle: card.subtitle,
          imageUrl: card.imageUrl,
          button: {
            title: ENTRY_TEXT[language].chooseButton,
            payload: encodePayload({ kind: 'product', via: 'choose', id: card.id }),
          },
        })),
      },
    };
    return reply.more
      ? [carousel, { text: ENTRY_TEXT[language].more, content: { kind: 'text' } }]
      : [carousel];
  }
  if (reply.kind === 'ask_slot' && reply.reason === 'photo' && reply.choices?.length === 1) {
    const buttons = PHOTO_BUTTONS[language];
    return [
      {
        text,
        content: {
          kind: 'quick_replies',
          options: [
            {
              title: buttons.yes,
              payload: encodePayload({ kind: 'pick', slot: 'product', id: reply.choices[0]!.id }),
            },
            { title: buttons.no, payload: encodePayload({ kind: 'not_it' }) },
          ],
        },
      },
    ];
  }
  const cards = reply.kind === 'ask_slot' ? reply.choices : undefined;
  if (cards && cards.length > 0 && cards.every((choice) => choice.card)) {
    const choices = cards;
    const carousel: Outgoing = {
      text: choices.map((choice) => `${choice.title} (${choice.card!.subtitle})`).join(', '),
      content: {
        kind: 'carousel',
        cards: choices.map((choice) => ({
          title: choice.title,
          subtitle: choice.card!.subtitle,
          imageUrl: choice.card!.imageUrl,
          button: {
            title: PHOTO_BUTTONS[language].choose,
            payload: encodePayload({ kind: 'pick', slot: 'product', id: choice.id }),
          },
        })),
      },
    };
    return [{ text, content: { kind: 'text' } }, carousel];
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
  if (reply.kind === 'ask_slot' && reply.offeredName !== undefined) {
    return [
      {
        text,
        content: {
          kind: 'quick_replies',
          options: [{ title: reply.offeredName, payload: encodePayload({ kind: 'name' }) }],
        },
      },
    ];
  }
  return [{ text, content: { kind: 'text' } }];
}
