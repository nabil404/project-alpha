import { Injectable } from '@nestjs/common';
import type { DeviceSession } from '@app/shared';
import {
  CodedConflictException,
  CodedNotFoundException,
} from '../../../common/errors/coded-exceptions';
import { describeUserAgent } from './describe-user-agent';
import { DeviceSessionRepository } from './device-session.repository';
import { SessionRevoker } from './session-revoker';

/** The seller's signed-in devices. Tokens and IP addresses never leave this service. */
@Injectable()
export class DeviceSessionsService {
  constructor(
    private readonly sessions: DeviceSessionRepository,
    private readonly revoker: SessionRevoker,
  ) {}

  async list(userId: string, currentSessionId: string): Promise<DeviceSession[]> {
    const rows = await this.sessions.listActive(userId, new Date());
    return rows
      .map((row) => ({
        id: row.id,
        ...describeUserAgent(row.userAgent),
        createdAt: row.createdAt.toISOString(),
        lastActiveAt: row.updatedAt.toISOString(),
        current: row.id === currentSessionId,
      }))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt),
      );
  }

  /** Ending this session is signing out, which has its own route. */
  async revoke(userId: string, currentSessionId: string, sessionId: string): Promise<void> {
    if (sessionId === currentSessionId) {
      throw new CodedConflictException(
        'SESSION_IS_CURRENT',
        'This is the session making the request; sign out instead',
      );
    }
    const row = await this.sessions.findActive(userId, sessionId, new Date());
    if (!row) {
      throw new CodedNotFoundException('SESSION_NOT_FOUND', 'No such session');
    }
    await this.revoker.revoke(row.token);
  }
}
