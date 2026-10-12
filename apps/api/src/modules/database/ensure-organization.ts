import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { Database } from './database.module';
import type { Executor } from './base.repository';
import { member, organization, user as userTable } from './schema/index';

/** The fields of a Better Auth user this needs; narrower than the full row. */
export interface OrganizationOwner {
  id: string;
  name: string;
}

/**
 * Returns the seller's organization id, creating it on first call. Without
 * one, TenantGuard rejects every request with TENANT_NO_ACTIVE_MERCHANT.
 *
 * It must be idempotent. Better Auth's user.create.after hook runs after the
 * user row commits, so if it fails, the session hook calls this again at the
 * next login and repairs the account.
 *
 * `organizationName` is the shop name from an email sign-up. Without it, the
 * shop is named after the seller. Membership is a table, so a seller could
 * later have several organizations; this picks the earliest.
 */
export async function ensureOrganizationForUser(
  db: Database,
  user: OrganizationOwner,
  organizationName: string = user.name,
): Promise<string> {
  const existing = await findEarliestOrganizationId(db, user.id);
  if (existing) {
    return existing;
  }

  return db.transaction(async (tx) => {
    // Lock the seller's user row so concurrent callers serialize. At READ
    // COMMITTED they can't see each other's uncommitted member row and would
    // both open a shop. A unique constraint on member.userId would stop that
    // too, but would forbid a second organization.
    await tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.id, user.id))
      .for('update')
      .limit(1);

    const raced = await findEarliestOrganizationId(tx, user.id);
    if (raced) {
      return raced;
    }

    const organizationId = randomUUID();

    await tx.insert(organization).values({
      id: organizationId,
      name: organizationName,
      // slug is NOT NULL and uniquely indexed. Deriving it from the seller's
      // name would collide on the second seller trading as "Shop", and that
      // collision would show up as a failed signup. The id is unique by
      // construction; nothing shows it to a seller yet, and it can be changed
      // once there is a settings screen to change it from.
      slug: organizationId,
      // Neither createdAt carries a database default. See schema/auth.ts.
      createdAt: new Date(),
    });

    await tx.insert(member).values({
      id: randomUUID(),
      organizationId,
      userId: user.id,
      // The column defaults to 'member'; the seller who signed up owns the shop.
      role: 'owner',
      createdAt: new Date(),
    });

    return organizationId;
  });
}

/**
 * The same, for the session hook, which has only a user id. It reads the user
 * for the shop name. Returns null when the user row is gone, which leaves the
 * session with no organization for the guard to reject.
 */
export async function ensureOrganizationForUserId(
  db: Database,
  userId: string,
): Promise<string | null> {
  const existing = await findEarliestOrganizationId(db, userId);
  if (existing) {
    return existing;
  }

  const rows = await db
    .select({ id: userTable.id, name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  const owner = rows[0];
  return owner ? await ensureOrganizationForUser(db, owner) : null;
}

/**
 * The seller's first organization, or null when they have none.
 *
 * Ordered so the answer is stable once a seller can hold several: without it
 * the active organization could differ between two logins for no visible
 * reason.
 */
export async function findEarliestOrganizationId(
  executor: Executor,
  userId: string,
): Promise<string | null> {
  const rows = await executor
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt), asc(member.id))
    .limit(1);

  return rows[0]?.organizationId ?? null;
}
