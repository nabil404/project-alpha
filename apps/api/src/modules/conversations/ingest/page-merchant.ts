import { sql } from 'drizzle-orm';
import type { Database } from '../../../database/database.module';

/**
 * The merchant that connected this Facebook Page, or null. Runs before any
 * merchant context exists, through the app_page_merchant() SECURITY DEFINER
 * function (migration 0011), because facebook_page is under forced RLS.
 */
export async function resolvePageMerchant(db: Database, pageId: string): Promise<string | null> {
  const result = await db.execute<{ merchant_id: string | null }>(
    sql`select app_page_merchant(${pageId}) as merchant_id`,
  );
  return result.rows[0]?.merchant_id ?? null;
}
