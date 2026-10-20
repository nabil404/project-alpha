import { ASSISTANT_TONES } from '@app/shared';
import { ASSISTANT_TONE_VALUES } from '../../../database/schema/settings';
import { phraseReplyPrompt } from '../../../llm/prompts/phrase-reply';
import { phraseVoice } from '../reply-phrasing';

describe('phraseVoice', () => {
  it("falls back to the country's language when the shop matches the customer", () => {
    expect(phraseVoice({ tone: 'friendly', defaultLanguage: 'match' }, 'bn')).toEqual({
      tone: 'friendly',
      language: 'bn',
    });
  });

  it("puts the shop's default language over the country's", () => {
    expect(phraseVoice({ tone: 'formal', defaultLanguage: 'ur' }, 'bn')).toEqual({
      tone: 'formal',
      language: 'ur',
    });
  });
});

describe('phraseReplyPrompt', () => {
  it('names the tone and the fallback language', () => {
    const prompt = phraseReplyPrompt(
      { instruction: 'Ask how many.', facts: {}, language: 'sw', tone: 'direct' },
      [],
    );

    expect(prompt).toContain('Tone: short and direct, with no small talk');
    expect(prompt).toContain('Fallback language: Swahili');
  });

  it('names Bangla as Bangla', () => {
    const prompt = phraseReplyPrompt(
      { instruction: 'Ask how many.', facts: {}, language: 'bn', tone: 'friendly' },
      [],
    );

    expect(prompt).toContain('Fallback language: Bangla');
  });
});

it("keeps the schema's literal copy of the tones equal to @app/shared's", () => {
  expect([...ASSISTANT_TONE_VALUES]).toEqual([...ASSISTANT_TONES]);
});
