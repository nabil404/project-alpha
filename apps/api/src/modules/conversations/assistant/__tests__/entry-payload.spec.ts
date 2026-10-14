import {
  describeZodIssue,
  encodePayload,
  GREETING_MAX,
  ICE_BREAKER_QUESTION_MAX,
  messengerProductLink,
  parsePayload,
  parseProductRef,
  welcomeScreenInputSchema,
  type AssistantPayload,
} from '@app/shared';

const ID = '8f3c2a1e-0000-4000-8000-000000000001';

describe('entry payloads', () => {
  it.each<AssistantPayload>([
    { kind: 'start' },
    { kind: 'browse', categoryId: null },
    { kind: 'browse', categoryId: ID },
    { kind: 'browse', categoryId: 'other' },
    { kind: 'product', via: 'choose', id: ID },
    { kind: 'product', via: 'ref', id: ID },
    { kind: 'menu', item: 'last-order' },
    { kind: 'menu', item: 'human' },
  ])('round-trips %j', (payload) => {
    expect(parsePayload(encodePayload(payload))).toEqual(payload);
  });

  it('leaves an ask ice breaker and anything foreign unparsed', () => {
    expect(parsePayload('ask')).toBeNull();
    expect(parsePayload('browse:cat:not-a-uuid')).toBeNull();
    expect(parsePayload(`choose:product:${ID}x`)).toBeNull();
  });
});

describe('product links', () => {
  it('builds the m.me link and parses its ref back', () => {
    expect(messengerProductLink('1234567890', ID)).toBe(`https://m.me/1234567890?ref=p_${ID}`);
    expect(parseProductRef(`p_${ID}`)).toBe(ID);
  });

  it.each(['', 'p_', `x_${ID}`, `p_${ID}_extra`, ID])('refuses ref %j', (ref) => {
    expect(parseProductRef(ref)).toBeNull();
  });
});

describe('welcomeScreenInputSchema', () => {
  const valid = {
    greeting: 'Hi {first_name}!',
    iceBreakers: [{ kind: 'browse', question: 'See products' }],
  };

  it('accepts a greeting and up to four questions', () => {
    expect(welcomeScreenInputSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a fifth question and an 81-character one', () => {
    const five = Array.from({ length: 5 }, () => ({ kind: 'ask', question: 'Q?' }));
    expect(welcomeScreenInputSchema.safeParse({ ...valid, iceBreakers: five }).success).toBe(false);
    const long = [{ kind: 'ask', question: 'x'.repeat(81) }];
    expect(welcomeScreenInputSchema.safeParse({ ...valid, iceBreakers: long }).success).toBe(false);
  });

  // Each emoji is one code point but two UTF-16 units, so `.max()` would reject 81 of them.
  it('counts greeting length in code points, not UTF-16 units', () => {
    const greeting = '\u{1F600}'.repeat(GREETING_MAX);
    expect(welcomeScreenInputSchema.safeParse({ ...valid, greeting }).success).toBe(true);
    expect(
      welcomeScreenInputSchema.safeParse({ ...valid, greeting: `${greeting}\u{1F600}` }).success,
    ).toBe(false);
  });

  it('counts a question in code points, not UTF-16 units', () => {
    const question = '\u{1F600}'.repeat(ICE_BREAKER_QUESTION_MAX);
    const input = (q: string) => ({ ...valid, iceBreakers: [{ kind: 'ask', question: q }] });
    expect(welcomeScreenInputSchema.safeParse(input(question)).success).toBe(true);
    expect(welcomeScreenInputSchema.safeParse(input(`${question}\u{1F600}`)).success).toBe(false);
  });

  it('counts a {first_name} as the 19 characters Meta receives', () => {
    const refused = `${'x'.repeat(148)}{first_name}`;
    const accepted = `${'x'.repeat(141)}{first_name}`;
    expect(welcomeScreenInputSchema.safeParse({ ...valid, greeting: refused }).success).toBe(false);
    expect(welcomeScreenInputSchema.safeParse({ ...valid, greeting: accepted }).success).toBe(true);
  });

  it('counts Bangla greeting length in characters', () => {
    const greeting = '\u0986'.repeat(GREETING_MAX);
    expect(welcomeScreenInputSchema.safeParse({ ...valid, greeting }).success).toBe(true);
    expect(
      welcomeScreenInputSchema.safeParse({ ...valid, greeting: `${greeting}\u0986` }).success,
    ).toBe(false);
  });

  it('reports an over-long greeting and question as MAX_LENGTH with the limit', () => {
    const greeting = welcomeScreenInputSchema.safeParse({ ...valid, greeting: 'x'.repeat(161) });
    const question = welcomeScreenInputSchema.safeParse({
      ...valid,
      iceBreakers: [{ kind: 'ask', question: 'x'.repeat(81) }],
    });
    expect(greeting.error?.issues.map(describeZodIssue)).toEqual([
      { code: 'MAX_LENGTH', params: { max: 160 } },
    ]);
    expect(question.error?.issues.map(describeZodIssue)).toEqual([
      { code: 'MAX_LENGTH', params: { max: 80 } },
    ]);
  });
});
