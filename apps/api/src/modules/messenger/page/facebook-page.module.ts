import { Module } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto.service';
import { AppConfig } from '../../config/app.config';
import { QueueModule } from '../../queue/queue.module';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { MessengerProfileSync } from '../profile/messenger-profile.sync';
import { FacebookPageController, PAGE_CONNECT_CALLBACK_PATH } from './facebook-page.controller';
import { FacebookPageRepository } from './facebook-page.repository';
import {
  FacebookPageService,
  META_GRAPH,
  PAGE_CONNECT_REDIRECT_URI,
} from './facebook-page.service';
import { MetaGraphClient } from './meta-graph.client';

/**
 * Page connection uses the Messenger app (META_APP_ID / META_APP_SECRET), not
 * the Facebook sign-in app: Page tokens and webhook subscriptions belong to the
 * app that obtained them, and the webhook checks signatures with
 * META_APP_SECRET. META_APP_ID is optional, so without it the API still boots
 * and connecting answers MESSENGER_NOT_CONFIGURED.
 */
@Module({
  imports: [QueueModule],
  controllers: [FacebookPageController],
  providers: [
    CryptoService,
    FacebookPageRepository,
    FacebookPageService,
    // Here, not in MessengerProfileModule: the Page service calls it on
    // connect and disconnect, and the sync needs this module's repository and
    // Graph client, so either home elsewhere is an import cycle. The settings
    // repository is stateless and provided locally for the same reason:
    // SettingsModule will call the sync on a country change.
    MerchantSettingsRepository,
    MessengerProfileSync,
    {
      provide: META_GRAPH,
      inject: [AppConfig],
      useFactory: (config: AppConfig): MetaGraphClient | null => {
        const appId = config.get('META_APP_ID');
        if (!appId) return null;
        return new MetaGraphClient({
          appId,
          appSecret: config.get('META_APP_SECRET'),
          version: config.get('META_GRAPH_VERSION'),
        });
      },
    },
    {
      provide: PAGE_CONNECT_REDIRECT_URI,
      inject: [AppConfig],
      useFactory: (config: AppConfig): string =>
        new URL(PAGE_CONNECT_CALLBACK_PATH, config.get('APP_URL')).toString(),
    },
  ],
  // META_GRAPH is shared so ingestion and seller replies use the same pinned
  // client (or null, and MESSENGER_NOT_CONFIGURED).
  exports: [FacebookPageRepository, META_GRAPH, MessengerProfileSync],
})
export class FacebookPageModule {}
