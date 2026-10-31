import { ASSISTANT_TONES } from '@app/shared';
import { ASSISTANT_TONE_VALUES } from '../../../database/schema/settings';
import { phraseReplyPrompt } from '../../../llm/prompts/phrase-reply';
import { promptPackFor } from '../../../llm/prompts/prompt-pack';
import { phraseRequestFor, phraseVoice } from '../reply-phrasing';
import type { ReplyIntent } from '../reply-intent';

describe('phraseVoice', () => {
  const bd = promptPackFor('BD');

  it("falls back to the region's language when the shop matches the customer", () => {
    expect(phraseVoice({ tone: 'friendly', defaultLanguage: 'match' }, bd)).toEqual({
      tone: 'friendly',
      language: 'bn',
      matchCustomer: true,
      pack: bd,
    });
    expect(
      phraseVoice({ tone: 'friendly', defaultLanguage: 'match' }, promptPackFor('IN')),
    ).toMatchObject({
      language: 'hi',
    });
  });

  it("puts the shop's default language over the region's", () => {
    expect(phraseVoice({ tone: 'formal', defaultLanguage: 'ur' }, bd)).toMatchObject({
      tone: 'formal',
      language: 'ur',
      matchCustomer: false,
    });
  });
});

describe('phraseRequestFor', () => {
  const bd = promptPackFor('BD');
  const ask: Extract<ReplyIntent, { kind: 'ask_slot' }> = {
    kind: 'ask_slot',
    slot: 'product',
    intent: 'other',
    facts: { items: [] },
  };

  it('acknowledges a greeting first in a friendly tone', () => {
    const voice = phraseVoice({ tone: 'friendly', defaultLanguage: 'match' }, bd);
    expect(phraseRequestFor(ask, voice).instruction).toBe(
      'Briefly acknowledge their last message first. Ask which product the customer would like to order.',
    );
  });

  it('skips the acknowledgement in a direct tone, which has no small talk', () => {
    const voice = phraseVoice({ tone: 'direct', defaultLanguage: 'match' }, bd);
    expect(phraseRequestFor(ask, voice).instruction).toBe(
      'Ask which product the customer would like to order.',
    );
  });
});

describe('phraseReplyPrompt', () => {
  it('names the tone and the fallback language', () => {
    const prompt = phraseReplyPrompt(
      {
        instruction: 'Ask how many.',
        facts: {},
        language: 'sw',
        matchCustomer: true,
        tone: 'direct',
        pack: promptPackFor('KE'),
      },
      [],
    );

    expect(prompt).toContain('Tone: short and direct, with no small talk');
    expect(prompt).toContain('Fallback language: Swahili');
  });

  it("names the seller's chosen language as the reply language, not a fallback", () => {
    const prompt = phraseReplyPrompt(
      {
        instruction: 'Ask how many.',
        facts: {},
        language: 'en',
        matchCustomer: false,
        tone: 'friendly',
        pack: promptPackFor('BD'),
      },
      [],
    );

    expect(prompt).toContain('Reply language: English');
    expect(prompt).not.toContain('Fallback language');
  });

  it('names Bangla as Bangla', () => {
    const prompt = phraseReplyPrompt(
      {
        instruction: 'Ask how many.',
        facts: {},
        language: 'bn',
        matchCustomer: true,
        tone: 'friendly',
        pack: promptPackFor('BD'),
      },
      [],
    );

    expect(prompt).toContain('Fallback language: Bangla');
  });
});

it("keeps the schema's literal copy of the tones equal to @app/shared's", () => {
  expect([...ASSISTANT_TONE_VALUES]).toEqual([...ASSISTANT_TONES]);
});
