import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE, type Database } from '../../database/database.module';
import { user } from '../../database/schema/index';

/**
 * `user` is Better Auth's table and carries no merchant_id or RLS policy; the
 * caller's user id comes from the session, never the request.
 */
@Injectable()
export class UserImageRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Sets the photo and returns the one it replaced. The row is locked first,
   * so of two concurrent uploads each learns exactly what it replaced and can
   * delete that object - neither is orphaned. Nothing but these two statements
   * runs inside the transaction.
   */
  swapImage(userId: string, image: string | null): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ image: user.image })
        .from(user)
        .where(eq(user.id, userId))
        .for('update');
      if (!row) {
        throw new Error('swapImage: no such user');
      }
      await tx.update(user).set({ image }).where(eq(user.id, userId));
      return row.image;
    });
  }
}
