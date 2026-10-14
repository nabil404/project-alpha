import { buildMessengerProfile } from '../messenger-profile';
import { defaultWelcome, readIceBreakers } from '../welcome-defaults';

describe('buildMessengerProfile', () => {
  it('builds the whole profile from the welcome screen, in English', () => {
    expect(
      buildMessengerProfile({
        greeting: 'Hi {first_name}! Welcome.',
        iceBreakers: [
          { kind: 'browse', question: 'See products' },
          { kind: 'ask', question: 'How do I pay?' },
        ],
        language: 'en',
      }),
    ).toEqual({
      get_started: { payload: 'start' },
      greeting: [{ locale: 'default', text: 'Hi {{user_first_name}}! Welcome.' }],
      ice_breakers: [
        {
          locale: 'default',
          call_to_actions: [
            { question: 'See products', payload: 'browse' },
            { question: 'How do I pay?', payload: 'ask' },
          ],
        },
      ],
      persistent_menu: [
        {
          locale: 'default',
          composer_input_disabled: false,
          call_to_actions: [
            { type: 'postback', title: 'Browse products', payload: 'browse' },
            { type: 'postback', title: 'My last order', payload: 'menu:last-order' },
            { type: 'postback', title: 'Talk to a person', payload: 'menu:human' },
          ],
        },
      ],
    });
  });

  it('sends no ice breakers as an empty list, so old ones are cleared', () => {
    expect(
      buildMessengerProfile({ greeting: 'Hi', iceBreakers: [], language: 'en' }).ice_breakers,
    ).toEqual([]);
  });

  it.each(['bn', 'en'] as const)('has defaults in %s that fit Meta’s limits', (language) => {
    const welcome = defaultWelcome(language);
    expect([...welcome.greeting].length).toBeLessThanOrEqual(160);
    expect(welcome.iceBreakers[0]).toMatchObject({ kind: 'browse' });
    expect(welcome.iceBreakers.length).toBeLessThanOrEqual(4);
  });
});

describe('readIceBreakers', () => {
  it('reads a stored list, and treats an unset or unreadable one as null', () => {
    expect(readIceBreakers([{ kind: 'ask', question: 'COD?' }])).toEqual([
      { kind: 'ask', question: 'COD?' },
    ]);
    expect(readIceBreakers([])).toEqual([]);
    expect(readIceBreakers(null)).toBeNull();
    expect(readIceBreakers([{ kind: 'nope', question: 'x' }])).toBeNull();
  });
});
