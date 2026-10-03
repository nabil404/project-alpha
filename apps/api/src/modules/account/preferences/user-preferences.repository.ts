import { Inject, Injectable } from '@nestjs/common';
import type { DashboardLocale } from '@app/shared';
import { eq } from 'drizzle-orm';
import { DATABASE, type Database } from '../../database/database.module';
import { user } from '../../database/schema/index';

/**
 * The signed-in person's own choices, on Better Auth's `user` row - not the
 * shop's, so each teammate keeps theirs. The user id comes from the session.
 */
@Injectable()
export class UserPreferencesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async setLocale(userId: string, locale: DashboardLocale | null): Promise<void> {
    await this.db.update(user).set({ locale }).where(eq(user.id, userId));
  }
}
