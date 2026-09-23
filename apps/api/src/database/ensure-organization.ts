import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { Database } from './database.module.js';
import type { Executor } from './base.repository.js';
import { member, organization, user as userTable } from './schema/index.js';

/** The fields of a Better Auth user this needs; narrower than the full row. */
export interface OrganizationOwner {
  id: string;
  name: string;
}

/**
 * Returns the seller's organization id, creating it on first call.
 *
 * Every business table's merchantId references organization.id, and
 * TenantGuard reads it off the session as activeOrganizationId. A seller with
 * no organization therefore has no merchant, and the guard answers every one of
 * their requests with TENANT_NO_ACTIVE_MERCHANT - locked out of their own
 * account. This is what stops that happening.
 *
 * **Idempotent by design, not as a nicety.** Better Auth's user.create.after
 * hook runs *after* the user row is committed, so a failure there would
 * otherwise strand a user with no organization and no way back. Because this
 * re-checks membership first, the session hook can call it again at next login
 * and repair the account rather than 403 forever.
 *
 * One organization per seller today - nothing creates a second - but the model
 * permits many: membership is a table, not a column, so a switcher later needs
 * no migration. Hence "the earliest membership" rather than "the membership".
 */
export async function ensureOrganizationForUser(
  db: Database,
  user: OrganizationOwner,
): Promise<string> {
  const existing = await findEarliestOrganizationId(db, user.id);
  if (existing) {
    return existing;
  }

  return db.transaction(async (tx) => {
    // Lock the seller's user row for the rest of the transaction.
    //
    // Re-reading membership is not enough on its own: at READ COMMITTED two
    // concurrent callers cannot see each other's uncommitted member row, so
    // both would find nothing and both would open a shop. Nor can a unique
    // constraint on member.userId save it - that would forbid the second
    // organization this model exists to allow. Serialising on the parent row
    // is what makes the re-check below meaningful.
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
      name: user.name,
      // slug is NOT NULL and uniquely indexed. Deriving it from the seller's
      // name would collide on the second seller trading as "Shop", and that
      // collision would surface as a failed signup. The id is unique by
      // construction; nothing shows it to a seller yet, and it can be changed
      // once there is a settings screen to change it from.
      slug: organizationId,
      // Neither createdAt carries a database default - see schema/auth.ts.
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
 * The same guarantee, for a caller holding only a user id.
 *
 * The session hook is that caller: a session row carries userId but not the
 * name organization.name needs, so the user is read back here rather than
 * making every caller do it. Returns null only when the user row is gone, which
 * leaves the session without an active organization and the guard rejecting it
 * - the correct outcome for a user that no longer exists.
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
