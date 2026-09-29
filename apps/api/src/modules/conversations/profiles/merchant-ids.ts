import { asc } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { organization } from '../../database/schema/index';

/**
 * Every merchant id, for jobs that run without a request. A merchant is a
 * Better Auth organization, whose table carries no row-level security, so this
 * needs no merchant context; everything read per merchant afterwards does.
 */
export async function listMerchantIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.id));
  return rows.map((row) => row.id);
}
