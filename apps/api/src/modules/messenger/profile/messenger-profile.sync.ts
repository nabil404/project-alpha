import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { DEFAULT_COUNTRY } from '@app/shared';
import type { Queue } from 'bullmq';
import { CryptoService } from '../../../common/crypto.service';
import { languageFor } from '../../conversations/assistant/assistant-fallbacks';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { customJobId } from '../../queue/job-id';
import {
  MESSENGER_PROFILE_QUEUE,
  SYNC_PROFILE_JOB,
  type SyncProfileJob,
} from '../../queue/queue.constants';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { FacebookPageRepository } from '../page/facebook-page.repository';
import { META_GRAPH } from '../page/facebook-page.tokens';
import { GraphError, MetaGraphClient } from '../page/meta-graph.client';
import { buildMessengerProfile } from './messenger-profile';
import { defaultWelcome, readIceBreakers } from './welcome-defaults';

/**
 * Three tries 10 s then 20 s apart, to ride out a short Graph outage; then the
 * dashboard shows `graph_error` until the next save.
 */
const SYNC_RETRY = { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } } as const;

/**
 * Keeps a Page's Messenger Profile in step with the shop's welcome screen.
 * Provided by FacebookPageModule, so the Page service can call it without a
 * module cycle; the processor that runs the jobs is worker-only. Graph calls
 * run outside transactions (invariant #1) and the token is never logged.
 */
@Injectable()
export class MessengerProfileSync {
  private readonly logger = new Logger(MessengerProfileSync.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly pages: FacebookPageRepository,
    private readonly settings: MerchantSettingsRepository,
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
    @InjectQueue(MESSENGER_PROFILE_QUEUE) private readonly queue: Queue,
  ) {}

  /** After the caller's commit. The job carries no settings: it reads the latest when it runs. */
  async request(merchantId: string, { resubscribe = false } = {}): Promise<void> {
    const at = new Date();
    await withMerchant(this.db, merchantId, (tx) =>
      this.pages.markProfileRequested(tx, { merchantId }, at),
    );
    const data: SyncProfileJob = { merchantId, ...(resubscribe ? { resubscribe } : {}) };
    await this.queue.add(SYNC_PROFILE_JOB, data, {
      jobId: customJobId('profile-', `${merchantId}-${at.getTime()}`),
      ...SYNC_RETRY,
    });
  }

  /**
   * Sends the whole profile. An invalid token is recorded and not retried; any
   * other Graph failure is recorded, then rethrown so BullMQ retries.
   */
  async run({ merchantId, resubscribe }: SyncProfileJob): Promise<'synced' | 'failed' | 'no_page'> {
    const scope = { merchantId };
    const read = await withMerchant(this.db, merchantId, async (tx) => ({
      page: await this.pages.findForMerchant(tx, scope),
      settings: await this.settings.find(tx, scope),
    }));
    if (!read.page || !this.graph) return 'no_page';

    const language = languageFor(read.settings?.country ?? DEFAULT_COUNTRY);
    const defaults = defaultWelcome(language);
    const body = buildMessengerProfile({
      greeting: read.settings?.messengerGreeting ?? defaults.greeting,
      iceBreakers: readIceBreakers(read.settings?.iceBreakers) ?? defaults.iceBreakers,
      language,
    });
    try {
      const token = this.crypto.decrypt(read.page.accessToken);
      if (resubscribe) await this.graph.subscribeApp(read.page.pageId, token);
      await this.graph.setMessengerProfile(token, body);
    } catch (error) {
      const code = isTokenError(error) ? 'token_invalid' : 'graph_error';
      await withMerchant(this.db, merchantId, (tx) =>
        this.pages.markProfileFailed(tx, scope, code, new Date()),
      );
      this.logger.warn(`Messenger Profile not synced (${code}) for shop ${merchantId}`);
      if (code === 'token_invalid') return 'failed';
      throw error;
    }
    await withMerchant(this.db, merchantId, (tx) =>
      this.pages.markProfileSynced(tx, scope, new Date()),
    );
    return 'synced';
  }

  /** Best effort, before the token is deleted. Never blocks a disconnect. */
  async clear({ merchantId }: TenantScope, encryptedToken: string): Promise<void> {
    if (!this.graph) return;
    try {
      await this.graph.clearMessengerProfile(this.crypto.decrypt(encryptedToken));
    } catch (error) {
      // GraphError carries no token or URL, so its message is safe to log.
      this.logger.warn(
        `Messenger Profile not cleared for shop ${merchantId}: ${error instanceof GraphError ? error.message : 'unknown error'}`,
      );
    }
  }
}

/** Graph's "access token invalid" (190), or an outright 401. */
const isTokenError = (error: unknown): boolean =>
  error instanceof GraphError && (error.graphCode === 190 || error.status === 401);
