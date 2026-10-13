import {
  encodePayload,
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

  it('counts Bangla greeting length in characters', () => {
    // 160 code points; several are combining vowel signs, still one code point each.
    const greeting = 'আ'.repeat(160);
    expect(welcomeScreenInputSchema.safeParse({ ...valid, greeting }).success).toBe(true);
    expect(welcomeScreenInputSchema.safeParse({ ...valid, greeting: `${greeting}আ` }).success).toBe(
      false,
    );
  });
});
