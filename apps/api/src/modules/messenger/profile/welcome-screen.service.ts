import { Inject, Injectable } from '@nestjs/common';
import type { ProfileSync, WelcomeScreen, WelcomeScreenInput } from '@app/shared';
import { languageFor } from '../../conversations/assistant/assistant-fallbacks';
import type { Executor, TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import type { FacebookPageRow } from '../../database/schema/index';
import { withMerchant } from '../../database/with-merchant';
import { defaultMerchantSettings } from '../../settings/general-settings.service';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { FacebookPageRepository } from '../page/facebook-page.repository';
import { MessengerProfileSync } from './messenger-profile.sync';
import { defaultWelcome, readIceBreakers } from './welcome-defaults';

/**
 * The seller's welcome screen: a greeting and up to four ice breakers. Until
 * the seller saves, the shop reads the defaults for its language. A save is
 * committed first; the Graph call happens in the worker, never here.
 */
@Injectable()
export class WelcomeScreenService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: MerchantSettingsRepository,
    private readonly pages: FacebookPageRepository,
    private readonly sync: MessengerProfileSync,
  ) {}

  get(scope: TenantScope): Promise<WelcomeScreen> {
    return withMerchant(this.db, scope.merchantId, (tx) => this.read(tx, scope));
  }

  async update(scope: TenantScope, input: WelcomeScreenInput): Promise<WelcomeScreen> {
    const connected = await withMerchant(this.db, scope.merchantId, async (tx) => {
      // A shop that never saved settings has no row yet.
      await this.settings.lockOrCreate(tx, scope, defaultMerchantSettings());
      await this.settings.updateWelcome(tx, scope, input);
      return (await this.pages.findForMerchant(tx, scope)) !== null;
    });
    if (connected) await this.sync.request(scope.merchantId);
    return this.get(scope);
  }

  private async read(tx: Executor, scope: TenantScope): Promise<WelcomeScreen> {
    const settings = await this.settings.find(tx, scope);
    const page = await this.pages.findForMerchant(tx, scope);
    const defaults = defaultWelcome(
      languageFor(settings?.country ?? defaultMerchantSettings().country),
    );
    const iceBreakers = readIceBreakers(settings?.iceBreakers);
    return {
      greeting: settings?.messengerGreeting ?? defaults.greeting,
      iceBreakers: iceBreakers ?? defaults.iceBreakers,
      isDefault: settings?.messengerGreeting == null && iceBreakers === null,
      profileSync: profileSyncOf(page),
    };
  }
}

/**
 * What the dashboard shows about the Page's copy: `pending` while a request is
 * newer than the last success, `failed` when that wait ended in an error.
 */
export function profileSyncOf(page: FacebookPageRow | null): ProfileSync {
  if (!page) return { status: 'not_connected', syncedAt: null, error: null };
  const syncedAt = page.profileSyncedAt?.toISOString() ?? null;
  const requested = page.profileSyncRequestedAt;
  const synced = page.profileSyncedAt;
  const behind = requested !== null && (synced === null || requested > synced);
  if (behind && page.profileSyncError) {
    return { status: 'failed', syncedAt, error: page.profileSyncError as ProfileSync['error'] };
  }
  return { status: behind ? 'pending' : 'live', syncedAt, error: null };
}
