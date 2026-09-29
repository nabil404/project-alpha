import { HttpException } from '@nestjs/common';
import type { DeviceSessionRepository, DeviceSessionRow } from '../device-session.repository';
import { DeviceSessionsService } from '../device-sessions.service';
import { SessionRevoker } from '../session-revoker';

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const row = (id: string, updatedAt: string, userAgent: string | null = MAC_CHROME) =>
  ({
    id,
    token: `token-${id}`,
    userAgent,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date(updatedAt),
  }) satisfies DeviceSessionRow;

class FakeRevoker extends SessionRevoker {
  readonly revoked: string[] = [];
  async revoke(token: string): Promise<void> {
    this.revoked.push(token);
  }
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof HttpException)) throw error;
  return { status: error.getStatus(), code: (error.getResponse() as { code?: unknown }).code };
}

describe('DeviceSessionsService', () => {
  const rows = [
    row('old', '2026-09-20T10:00:00Z'),
    row('current', '2026-09-10T10:00:00Z'),
    row('recent', '2026-09-29T10:00:00Z', null),
  ];
  const repository = {
    listActive: async () => rows,
    findActive: async (_userId: string, id: string) => rows.find((r) => r.id === id),
  } as unknown as DeviceSessionRepository;
  let revoker: FakeRevoker;
  let service: DeviceSessionsService;

  beforeEach(() => {
    revoker = new FakeRevoker();
    service = new DeviceSessionsService(repository, revoker);
  });

  it('lists the current session first, then the most recently active', async () => {
    const list = await service.list('user', 'current');

    expect(list.map((s) => [s.id, s.current])).toEqual([
      ['current', true],
      ['recent', false],
      ['old', false],
    ]);
  });

  it('describes the device and never exposes the token', async () => {
    const [current, recent] = await service.list('user', 'current');

    expect(current).toEqual({
      id: 'current',
      browser: 'Chrome',
      os: 'macOS',
      createdAt: '2026-09-01T10:00:00.000Z',
      lastActiveAt: '2026-09-10T10:00:00.000Z',
      current: true,
    });
    expect(recent).toMatchObject({ browser: null, os: null });
    expect(JSON.stringify(await service.list('user', 'current'))).not.toContain('token-');
  });

  it('revokes another session by its token', async () => {
    await service.revoke('user', 'current', 'old');

    expect(revoker.revoked).toEqual(['token-old']);
  });

  it('refuses the session making the request', async () => {
    expect(await codeOf(service.revoke('user', 'current', 'current'))).toEqual({
      status: 409,
      code: 'SESSION_IS_CURRENT',
    });
    expect(revoker.revoked).toEqual([]);
  });

  it('answers 404 for a session that is not one of the user’s live ones', async () => {
    expect(await codeOf(service.revoke('user', 'current', 'gone'))).toEqual({
      status: 404,
      code: 'SESSION_NOT_FOUND',
    });
  });
});
