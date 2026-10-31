import { STALE_CHAT_DAYS, staleReply, turnGate } from '../turn-gate';

const at = (s: number) => new Date(Date.UTC(2026, 9, 10, 10, 0, s));
const msg = (
  id: string,
  sender: 'customer' | 'assistant' | 'seller',
  s: number,
  extra: { kind?: 'text' | 'reaction' | 'sticker'; editedAt?: Date } = {},
) => ({ id, sender, sentAt: at(s), kind: extra.kind ?? 'text', editedAt: extra.editedAt ?? null });
const open = { botPaused: false, state: 'collecting_details' as const };

describe('turnGate', () => {
  it('goes when the trigger is the newest message', () => {
    expect(turnGate(open, [msg('m2', 'customer', 2), msg('a1', 'assistant', 1)], 'm2')).toBe('go');
  });
  it('stops when the seller took over', () => {
    expect(turnGate({ ...open, botPaused: true }, [msg('m1', 'customer', 1)], 'm1')).toBe('paused');
  });
  it('stops in handed_off and confirmed', () => {
    expect(
      turnGate({ botPaused: false, state: 'handed_off' }, [msg('m1', 'customer', 1)], 'm1'),
    ).toBe('closed');
    expect(
      turnGate({ botPaused: false, state: 'confirmed' }, [msg('m1', 'customer', 1)], 'm1'),
    ).toBe('closed');
  });
  it('is stale when a newer customer message exists, or the trigger is not in view', () => {
    expect(turnGate(open, [msg('m2', 'customer', 2), msg('m1', 'customer', 1)], 'm1')).toBe(
      'stale',
    );
    expect(turnGate(open, [msg('m9', 'customer', 9)], 'm1')).toBe('stale');
  });
  it('is answered when a reply is newer than the trigger', () => {
    expect(turnGate(open, [msg('a1', 'assistant', 2), msg('m1', 'customer', 1)], 'm1')).toBe(
      'answered',
    );
    expect(turnGate(open, [msg('s1', 'seller', 2), msg('m1', 'customer', 1)], 'm1')).toBe(
      'answered',
    );
  });
  it('is not made stale by a newer reaction, but a reaction is by a newer message', () => {
    const reaction = msg('r1', 'customer', 2, { kind: 'reaction' });
    expect(turnGate(open, [reaction, msg('m1', 'customer', 1)], 'm1')).toBe('go');
    expect(turnGate(open, [reaction, msg('m1', 'customer', 1)], 'r1')).toBe('go');
    expect(turnGate(open, [msg('m2', 'customer', 3), reaction], 'r1')).toBe('stale');
  });
  it('asks again after an edit: a reply before the edit no longer answers it', () => {
    const edited = msg('m1', 'customer', 1, { editedAt: at(5) });
    expect(turnGate(open, [msg('a1', 'assistant', 2), edited], 'm1')).toBe('go');
    expect(
      turnGate(open, [msg('a2', 'assistant', 6), msg('a1', 'assistant', 2), edited], 'm1'),
    ).toBe('answered');
  });
});

describe('staleReply', () => {
  const daysLater = (days: number) => (id: string) => ({
    ...msg(id, 'customer', 0),
    sentAt: new Date(at(0).getTime() + days * 24 * 60 * 60 * 1000),
  });
  const reply = msg('a1', 'assistant', 0);

  it('is the shop’s last message when the customer comes back after STALE_CHAT_DAYS', () => {
    expect(staleReply([daysLater(STALE_CHAT_DAYS)('m2'), reply], 'm2')).toBe(reply);
  });
  it('is null when the shop spoke within STALE_CHAT_DAYS', () => {
    expect(staleReply([daysLater(STALE_CHAT_DAYS - 1)('m2'), reply], 'm2')).toBeNull();
  });
  it('looks past the customer’s own burst to the shop’s reply', () => {
    const burst = [daysLater(STALE_CHAT_DAYS)('m3'), daysLater(STALE_CHAT_DAYS)('m2'), reply];
    expect(staleReply(burst, 'm3')).toBe(reply);
  });
  it('counts a seller’s message as the shop speaking', () => {
    const seller = msg('s1', 'seller', 0);
    expect(staleReply([daysLater(STALE_CHAT_DAYS)('m2'), seller], 'm2')).toBe(seller);
  });
  it('is null when the shop never spoke, or the trigger is not in view', () => {
    expect(
      staleReply([daysLater(STALE_CHAT_DAYS)('m2'), msg('m1', 'customer', 0)], 'm2'),
    ).toBeNull();
    expect(staleReply([reply], 'm9')).toBeNull();
  });
});
