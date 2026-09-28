import { Module } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto.service';
import { AppConfig } from '../../../config/app.config';
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
  controllers: [FacebookPageController],
  providers: [
    CryptoService,
    FacebookPageRepository,
    FacebookPageService,
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
  exports: [FacebookPageRepository],
})
export class FacebookPageModule {}
