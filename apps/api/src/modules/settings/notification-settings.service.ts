import { Inject, Injectable } from '@nestjs/common';
import {
  NOTIFICATION_DEFAULTS,
  type NotificationSettings,
  type UpdateNotificationSettings,
} from '@app/shared';
import type { TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { NotificationPreferencesRepository } from './notification-preferences.repository';

/**
 * Settings > Notifications: the signed-in person's switches for the active
 * shop. Each switch saves on its own, so an update writes only what it was
 * sent and two quick toggles cannot undo each other.
 */
@Injectable()
export class NotificationSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly preferences: NotificationPreferencesRepository,
  ) {}

  get(scope: TenantScope, userId: string): Promise<NotificationSettings> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      return (await this.preferences.find(tx, scope, userId)) ?? { ...NOTIFICATION_DEFAULTS };
    });
  }

  update(
    scope: TenantScope,
    userId: string,
    changes: UpdateNotificationSettings,
  ): Promise<NotificationSettings> {
    if (Object.keys(changes).length === 0) return this.get(scope, userId);
    return withMerchant(this.db, scope.merchantId, (tx) =>
      this.preferences.upsert(tx, scope, userId, changes),
    );
  }
}
