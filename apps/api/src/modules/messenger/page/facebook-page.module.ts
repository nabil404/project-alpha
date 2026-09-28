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
 * Page connection uses the same Meta app as Facebook sign-in
 * (FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET). Both are optional in the
 * environment, so without them the API still boots and connecting answers
 * MESSENGER_NOT_CONFIGURED.
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
        const appId = config.get('FACEBOOK_CLIENT_ID');
        const appSecret = config.get('FACEBOOK_CLIENT_SECRET');
        if (!appId || !appSecret) return null;
        return new MetaGraphClient({ appId, appSecret, version: config.get('META_GRAPH_VERSION') });
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
