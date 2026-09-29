import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from '../../../database/database.module';
import * as schema from '../../../database/schema/index';
import { DeviceSessionRepository } from '../device-session.repository';

const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

const HOUR = 60 * 60 * 1000;

describeDb('DeviceSessionRepository', () => {
  let pool: Pool;
  let db: Database;
  let repository: DeviceSessionRepository;
  let owner: string;
  let stranger: string;
  const now = new Date();

  const insertUser = async () => {
    const id = randomUUID().replaceAll('-', '');
    await db.insert(schema.user).values({
      id,
      name: 'Test',
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  const insertSession = async (userId: string, expiresInMs: number) => {
    const id = randomUUID().replaceAll('-', '');
    await db.insert(schema.session).values({
      id,
      token: randomUUID(),
      userId,
      expiresAt: new Date(now.getTime() + expiresInMs),
      createdAt: now,
      updatedAt: now,
      userAgent: 'Mozilla/5.0',
    });
    return id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema });
    repository = new DeviceSessionRepository(db);
    owner = await insertUser();
    stranger = await insertUser();
  });

  afterAll(async () => {
    // session cascades from user.
    await db.delete(schema.user).where(inArray(schema.user.id, [owner, stranger]));
    await pool.end();
  });

  it("lists only the user's unexpired sessions", async () => {
    const live = await insertSession(owner, HOUR);
    await insertSession(owner, -HOUR);
    await insertSession(stranger, HOUR);

    const rows = await repository.listActive(owner, now);

    expect(rows.map((row) => row.id)).toEqual([live]);
  });

  it("finds a session only when it is the user's and unexpired", async () => {
    const live = await insertSession(owner, HOUR);
    const expired = await insertSession(owner, -HOUR);
    const theirs = await insertSession(stranger, HOUR);

    expect((await repository.findActive(owner, live, now))?.id).toBe(live);
    expect(await repository.findActive(owner, expired, now)).toBeUndefined();
    expect(await repository.findActive(owner, theirs, now)).toBeUndefined();
  });
});
