import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from '../../../database/database.module';
import * as schema from '../../../database/schema/index';
import { UserImageRepository } from '../user-image.repository';

// Needs a real Postgres: the row lock is server behaviour.
const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

describeDb('UserImageRepository', () => {
  let pool: Pool;
  let db: Database;
  let repository: UserImageRepository;
  let userId: string;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema });
    repository = new UserImageRepository(db);
  });

  beforeEach(async () => {
    userId = randomUUID().replaceAll('-', '');
    const now = new Date();
    await db.insert(schema.user).values({
      id: userId,
      name: 'Nadia Rahman',
      email: `${userId}@example.test`,
      emailVerified: true,
      image: 'https://lh3.googleusercontent.com/a/photo',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => db.delete(schema.user).where(eq(schema.user.id, userId)));
  afterAll(() => pool.end());

  it('sets the image and returns the one it replaced', async () => {
    expect(await repository.swapImage(userId, 'https://media.example.test/a.jpg')).toBe(
      'https://lh3.googleusercontent.com/a/photo',
    );
    expect(await repository.swapImage(userId, null)).toBe('https://media.example.test/a.jpg');

    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    expect(row?.image).toBeNull();
  });

  it('hands each of two concurrent swaps a different previous image', async () => {
    const previous = await Promise.all([
      repository.swapImage(userId, 'https://media.example.test/a.jpg'),
      repository.swapImage(userId, 'https://media.example.test/b.jpg'),
    ]);

    expect(new Set(previous).size).toBe(2);
    expect(previous).toContain('https://lh3.googleusercontent.com/a/photo');
  });

  it('throws for a user that does not exist', async () => {
    await expect(repository.swapImage('missing', null)).rejects.toThrow();
  });
});
