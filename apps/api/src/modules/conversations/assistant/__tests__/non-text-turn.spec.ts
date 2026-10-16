import { emptySlots, type MessageKind } from '@app/shared';
import { decideNonText } from '../non-text-turn';
import type { ActiveState } from '../conversation-machine';
import { chatText, isEmojiOnly } from '../../message-content';

const slots = { ...emptySlots(), deliveryAddress: undefined };
const decide = (
  state: ActiveState,
  kind: MessageKind,
  { text = '', previousKind = null as MessageKind | null, emoji = '❤️', label = 'love' } = {},
) =>
  decideNonText({
    state,
    slots,
    trigger: {
      kind,
      text,
      details:
        kind === 'reaction'
          ? { reaction: { emoji, label, targetMid: 'mid', targetMessageId: null } }
          : {},
    },
    previousKind,
  });

const NON_TEXT: { kind: MessageKind; text?: string }[] = [
  { kind: 'sticker', text: '👍' },
  { kind: 'sticker', text: 'Sent a sticker' },
  { kind: 'reaction' },
  { kind: 'text', text: '👍' },
  { kind: 'text', text: '❤️❤️' },
  { kind: 'location' },
  { kind: 'image' },
  { kind: 'video' },
  { kind: 'audio' },
  { kind: 'file' },
  { kind: 'other' },
];

describe('decideNonText', () => {
  it('leaves a shared post to the turn, in any state, so it is never a confirmation', () => {
    expect(decide('browsing', 'share')).toBeNull();
    expect(decide('awaiting_confirmation', 'share')).toBeNull();
  });

  it('leaves words to the LLM', () => {
    expect(decide('browsing', 'text', { text: 'red saree' })).toBeNull();
    expect(decide('awaiting_confirmation', 'text', { text: 'ok 👍' })).toBeNull();
  });

  it.each(NON_TEXT)(
    'on the summary card, $kind "$text" points to Confirm and changes nothing',
    ({ kind, text }) => {
      expect(decide('awaiting_confirmation', kind, { text })).toEqual({
        state: 'awaiting_confirmation',
        slots,
        reply: { kind: 'notice', notice: 'use_confirm' },
      });
    },
  );

  it('answers a reaction on the card only when it reads as a yes', () => {
    expect(
      decide('awaiting_confirmation', 'reaction', { emoji: '👍', label: 'like' }),
    ).toMatchObject({
      reply: { notice: 'use_confirm' },
    });
    expect(decide('awaiting_confirmation', 'reaction', { emoji: '😢', label: 'sad' })).toBe(
      'silent',
    );
  });

  it('says nothing to a reaction elsewhere', () => {
    expect(decide('browsing', 'reaction')).toBe('silent');
    expect(decide('collecting_details', 'reaction')).toBe('silent');
  });

  it('nudges a sticker or an emoji to type, with no state change', () => {
    for (const trigger of [{ kind: 'sticker' as const }, { kind: 'text' as const, text: '🙏🏽' }]) {
      expect(decide('collecting_details', trigger.kind, { text: trigger.text })).toEqual({
        state: 'collecting_details',
        slots,
        reply: { kind: 'notice', notice: 'type_please' },
      });
    }
  });

  it('asks for a written address for a pin, and never fills it', () => {
    const decision = decide('collecting_details', 'location');
    expect(decision).toMatchObject({
      state: 'collecting_details',
      reply: { notice: 'location_write_address' },
    });
    expect(decision !== 'silent' && decision?.slots.deliveryAddress).toBeUndefined();
  });

  it('says it reads only text and photos, then hands off when the customer insists', () => {
    expect(decide('browsing', 'video')).toMatchObject({ reply: { notice: 'text_only' } });
    expect(decide('browsing', 'file', { previousKind: 'video' })).toMatchObject({
      state: 'handed_off',
      reply: { kind: 'handoff', reason: 'unreadable' },
    });
  });

  it.each(['browsing', 'collecting_details'] as const)(
    'leaves a photo in %s to the turn, which matches it to the catalog',
    (state) => {
      expect(decide(state, 'image')).toBeNull();
    },
  );
});

describe('isEmojiOnly', () => {
  it.each(['👍', '❤️', '🙏🏽', '👨‍👩‍👧', '🇧🇩', ' 😍 😍 '])('reads %p as emoji only', (text) => {
    expect(isEmojiOnly(text)).toBe(true);
  });
  it.each(['ok', 'ok 👍', '2', '#1', '', '  ', '১টা'])('reads %p as words', (text) => {
    expect(isEmojiOnly(text)).toBe(false);
  });
});

describe('chatText', () => {
  it('gives the LLM words, the Like sticker as 👍, and a tag for anything else', () => {
    expect(chatText({ kind: 'text', text: 'red saree' })).toBe('red saree');
    expect(chatText({ kind: 'sticker', text: '👍' })).toBe('👍');
    expect(chatText({ kind: 'sticker', text: '' })).toBe('[sent a sticker]');
    expect(chatText({ kind: 'location', text: '' })).toBe('[shared a location]');
  });
});
