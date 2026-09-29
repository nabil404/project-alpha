import {
  PREVIEW_LENGTH,
  PROFILE_REFRESH_MS,
  PROFILE_RETRY_MS,
  isReplyWindowOpen,
  isUnread,
  likePattern,
  messagePreview,
  needsProfile,
  replyWindowClosesAt,
  stateAfterHandBack,
} from '../conversation-rules';

const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;

describe('messagePreview', () => {
  it('keeps short text, collapsing whitespace and newlines', () => {
    expect(messagePreview('  01712-345678,\nHouse 12  ')).toBe('01712-345678, House 12');
  });

  it('cuts long text to the preview length with an ellipsis', () => {
    const preview = messagePreview('a'.repeat(200));
    expect(Array.from(preview)).toHaveLength(PREVIEW_LENGTH);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('never splits an emoji or a Bangla letter from its vowel sign', () => {
    const thumbs = messagePreview('👍🏽'.repeat(150));
    expect(thumbs).toBe(`${'👍🏽'.repeat(PREVIEW_LENGTH - 1)}…`);

    const bangla = messagePreview('কি'.repeat(150));
    expect(bangla).toBe(`${'কি'.repeat(PREVIEW_LENGTH - 1)}…`);
  });
});

describe('stateAfterHandBack', () => {
  it('browses when nothing was collected, otherwise keeps collecting', () => {
    expect(stateAfterHandBack({})).toBe('browsing');
    expect(stateAfterHandBack({ quantity: 2 })).toBe('collecting_details');
  });
});

describe('the reply window', () => {
  const lastInbound = at('2026-09-29T10:00:00.000Z');

  it("is open until exactly 24 hours after the customer's last message", () => {
    expect(
      isReplyWindowOpen(lastInbound, new Date(lastInbound.getTime() + 24 * HOUR - 60_000)),
    ).toBe(true);
    expect(isReplyWindowOpen(lastInbound, new Date(lastInbound.getTime() + 24 * HOUR))).toBe(false);
    expect(replyWindowClosesAt(lastInbound)).toEqual(at('2026-09-30T10:00:00.000Z'));
  });

  it('is closed when the customer never wrote', () => {
    expect(isReplyWindowOpen(null, lastInbound)).toBe(false);
    expect(replyWindowClosesAt(null)).toBeNull();
  });
});

describe('isUnread', () => {
  it('is unread when the customer wrote after the seller last read', () => {
    expect(isUnread(at('2026-09-29T10:00:00Z'), null)).toBe(true);
    expect(isUnread(at('2026-09-29T10:00:00Z'), at('2026-09-29T09:00:00Z'))).toBe(true);
    expect(isUnread(at('2026-09-29T10:00:00Z'), at('2026-09-29T10:00:00Z'))).toBe(false);
    expect(isUnread(null, null)).toBe(false);
  });
});

describe('needsProfile', () => {
  const now = at('2026-09-29T10:00:00Z');
  const PIC = 'https://platform-lookaside.fbsbx.com/pic';

  it('retries a named customer without a picture after the retry period', () => {
    expect(
      needsProfile(
        {
          name: 'Nusrat',
          pictureUrl: null,
          profileFetchedAt: new Date(now.getTime() - PROFILE_RETRY_MS),
        },
        now,
      ),
    ).toBe(true);
    expect(
      needsProfile(
        { name: 'Nusrat', pictureUrl: null, profileFetchedAt: new Date(now.getTime() - HOUR) },
        now,
      ),
    ).toBe(false);
  });

  it('asks Facebook for a new customer and for a nameless one after the retry period', () => {
    expect(needsProfile(null, now)).toBe(true);
    expect(needsProfile({ name: null, pictureUrl: null, profileFetchedAt: null }, now)).toBe(true);
    expect(
      needsProfile(
        {
          name: null,
          pictureUrl: null,
          profileFetchedAt: new Date(now.getTime() - PROFILE_RETRY_MS),
        },
        now,
      ),
    ).toBe(true);
  });

  it('refreshes a named customer once their picture link may have expired', () => {
    expect(needsProfile({ name: 'Nusrat', pictureUrl: PIC, profileFetchedAt: null }, now)).toBe(
      true,
    );
    expect(
      needsProfile(
        {
          name: 'Nusrat',
          pictureUrl: PIC,
          profileFetchedAt: new Date(now.getTime() - PROFILE_REFRESH_MS),
        },
        now,
      ),
    ).toBe(true);
  });

  it('does not ask again within the retry or refresh period', () => {
    expect(
      needsProfile(
        { name: null, pictureUrl: null, profileFetchedAt: new Date(now.getTime() - HOUR) },
        now,
      ),
    ).toBe(false);
    expect(
      needsProfile(
        {
          name: 'Nusrat',
          pictureUrl: PIC,
          profileFetchedAt: new Date(now.getTime() - PROFILE_RETRY_MS),
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('likePattern', () => {
  it('matches the term literally as a substring', () => {
    expect(likePattern('kurti')).toBe('%kurti%');
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});
