import type { FacebookPageRow } from '../../../database/schema/index';
import { profileSyncOf } from '../welcome-screen.service';

const at = (iso: string) => new Date(iso);
const page = (over: Partial<FacebookPageRow>) =>
  ({
    profileSyncRequestedAt: null,
    profileSyncedAt: null,
    profileSyncError: null,
    ...over,
  }) as FacebookPageRow;

describe('profileSyncOf', () => {
  it('is not_connected without a Page', () => {
    expect(profileSyncOf(null)).toEqual({ status: 'not_connected', syncedAt: null, error: null });
  });

  it('is pending while a request is newer than the last success, or never synced', () => {
    expect(
      profileSyncOf(page({ profileSyncRequestedAt: at('2026-10-14T10:00:00Z') })),
    ).toMatchObject({ status: 'pending', syncedAt: null });
    expect(
      profileSyncOf(
        page({
          profileSyncRequestedAt: at('2026-10-14T10:00:00Z'),
          profileSyncedAt: at('2026-10-14T09:00:00Z'),
        }),
      ),
    ).toMatchObject({ status: 'pending', syncedAt: '2026-10-14T09:00:00.000Z' });
  });

  it('is failed when an error was recorded while the Page is behind the request', () => {
    expect(
      profileSyncOf(
        page({
          profileSyncRequestedAt: at('2026-10-14T10:00:00Z'),
          profileSyncedAt: at('2026-10-14T09:00:00Z'),
          profileSyncError: 'graph_error',
        }),
      ),
    ).toMatchObject({ status: 'failed', error: 'graph_error' });
  });

  it('is live once the last success is at or after the request', () => {
    expect(
      profileSyncOf(
        page({
          profileSyncRequestedAt: at('2026-10-14T10:00:00Z'),
          profileSyncedAt: at('2026-10-14T10:00:00Z'),
        }),
      ),
    ).toMatchObject({ status: 'live', error: null });
  });
});
