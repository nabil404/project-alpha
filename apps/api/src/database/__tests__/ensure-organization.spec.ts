import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from '../database.module.js';
import {
  ensureOrganizationForUser,
  ensureOrganizationForUserId,
  findEarliestOrganizationId,
} from '../ensure-organization.js';
import * as schema from '../schema/index.js';

// Needs a real Postgres: the uniqueness of organization.slug and the
// transaction the helper opens are server behaviours, not something a fake can
// demonstrate. CI sets DATABASE_ADMIN_URL; locally, export it (pointing at
// docker/compose.dev.yml) to run these.
const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

describeDb('ensureOrganizationForUser', () => {
  let db: Database;
  let pool: Pool;
  const createdUserIds: string[] = [];

  /** A committed Better Auth user row, which the FKs on member require. */
  const insertUser = async (name: string): Promise<{ id: string; name: string }> => {
    const id = randomUUID();
    await db.insert(schema.user).values({
      id,
      name,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdUserIds.push(id);
    return { id, name };
  };

  const membersOf = async (userId: string) =>
    db.select().from(schema.member).where(eq(schema.member.userId, userId));

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    // member cascades from user; organization does not, so it goes first.
    if (createdUserIds.length > 0) {
      const orgIds = (
        await db
          .select({ id: schema.member.organizationId })
          .from(schema.member)
          .where(inArray(schema.member.userId, createdUserIds))
      ).map((row) => row.id);

      await db.delete(schema.user).where(inArray(schema.user.id, createdUserIds));
      if (orgIds.length > 0) {
        await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds));
      }
    }
    await pool.end();
  });

  it('creates exactly one organization, owned by the seller', async () => {
    const user = await insertUser('Nadia Rahman');
    const organizationId = await ensureOrganizationForUser(db, user);

    const members = await membersOf(user.id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ organizationId, role: 'owner' });

    const orgs = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId));
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toBe('Nadia Rahman');
  });

  // The property the whole design leans on: user.create.after runs after the
  // user row is committed, so a failure there must be repairable at next login
  // rather than stranding the seller with no merchant.
  it('is idempotent - a second call creates nothing and returns the same id', async () => {
    const user = await insertUser('Repeat Seller');

    const first = await ensureOrganizationForUser(db, user);
    const second = await ensureOrganizationForUser(db, user);

    expect(second).toBe(first);
    await expect(membersOf(user.id)).resolves.toHaveLength(1);
  });

  // A slug derived from the seller's name would collide here, and the collision
  // would surface as a failed signup for the second seller.
  it('gives two sellers trading under the same name distinct organizations', async () => {
    const [a, b] = await Promise.all([insertUser('Shop'), insertUser('Shop')]);
    const [orgA, orgB] = await Promise.all([
      ensureOrganizationForUser(db, a),
      ensureOrganizationForUser(db, b),
    ]);

    expect(orgA).not.toBe(orgB);

    const slugs = await db
      .select({ slug: schema.organization.slug })
      .from(schema.organization)
      .where(inArray(schema.organization.id, [orgA, orgB]));
    expect(new Set(slugs.map((row) => row.slug)).size).toBe(2);
  });

  // Two sign-in requests racing for the same user must not each open a shop.
  it('creates one organization when called concurrently for the same user', async () => {
    const user = await insertUser('Concurrent Seller');

    const results = await Promise.all([
      ensureOrganizationForUser(db, user),
      ensureOrganizationForUser(db, user),
      ensureOrganizationForUser(db, user),
    ]);

    await expect(membersOf(user.id)).resolves.toHaveLength(1);
    expect(new Set(results).size).toBe(1);
  });

  it('returns null rather than inventing an organization for a user that does not exist', async () => {
    await expect(ensureOrganizationForUserId(db, randomUUID())).resolves.toBeNull();
  });

  it('self-heals a user whose signup left them with no organization', async () => {
    const user = await insertUser('Stranded Seller');
    await expect(findEarliestOrganizationId(db, user.id)).resolves.toBeNull();

    const organizationId = await ensureOrganizationForUserId(db, user.id);

    expect(organizationId).not.toBeNull();
    await expect(findEarliestOrganizationId(db, user.id)).resolves.toBe(organizationId);
  });

  // Only reachable once a switcher exists, but the ordering is what makes the
  // active organization stable across logins, so it is pinned now.
  it('picks the earliest membership when a seller holds several', async () => {
    const user = await insertUser('Two Shops');
    const first = await ensureOrganizationForUser(db, user);

    const second = randomUUID();
    await db
      .insert(schema.organization)
      .values({ id: second, name: 'Second Shop', slug: second, createdAt: new Date() });
    await db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: second,
      userId: user.id,
      role: 'owner',
      // Later than the first membership, so it must not win.
      createdAt: new Date(Date.now() + 60_000),
    });

    await expect(findEarliestOrganizationId(db, user.id)).resolves.toBe(first);
    await db.delete(schema.organization).where(eq(schema.organization.id, second));
  });
});
