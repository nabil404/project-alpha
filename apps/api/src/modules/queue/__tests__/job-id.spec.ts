import { customJobId } from '../job-id';

describe('customJobId', () => {
  it('leaves an id without a colon or percent sign as it is', () => {
    expect(customJobId('turn-', 'm_abc-DEF_123')).toBe('turn-m_abc-DEF_123');
  });

  it('escapes the colon BullMQ refuses, keeping distinct ids distinct', () => {
    const colon = customJobId('', 'm_abc:1');
    const escaped = customJobId('', 'm_abc%3A1');
    expect(colon).not.toContain(':');
    expect(colon).not.toBe(escaped);
  });
});
