import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { DATABASE, type Database } from '../../database/database.module';
import { session } from '../../database/schema/index';

export interface DeviceSessionRow {
  id: string;
  /** Leaves this module only as the argument to SessionRevoker. */
  token: string;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const columns = {
  id: session.id,
  token: session.token,
  userAgent: session.userAgent,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
};

/** Reads Better Auth's session table; every query is scoped to the session's own user. */
@Injectable()
export class DeviceSessionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  listActive(userId: string, now: Date): Promise<DeviceSessionRow[]> {
    return this.db
      .select(columns)
      .from(session)
      .where(and(eq(session.userId, userId), gt(session.expiresAt, now)));
  }

  async findActive(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<DeviceSessionRow | undefined> {
    const [row] = await this.db
      .select(columns)
      .from(session)
      .where(
        and(eq(session.id, sessionId), eq(session.userId, userId), gt(session.expiresAt, now)),
      );
    return row;
  }
}
