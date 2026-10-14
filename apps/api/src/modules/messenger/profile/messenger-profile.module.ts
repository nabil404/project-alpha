import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { FacebookPageModule } from '../page/facebook-page.module';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { MessengerProfileProcessor } from './messenger-profile.processor';
import { WelcomeScreenController } from './welcome-screen.controller';
import { WelcomeScreenService } from './welcome-screen.service';

/**
 * The Messenger Profile, live in the API and the worker. MessengerProfileSync
 * itself is provided and exported by FacebookPageModule: the Page service
 * calls it on connect and disconnect, and this module needs the Page's
 * repository and Graph client, so owning it here would make the two modules
 * import each other. Re-exported, so importing this module is enough.
 */
@Module({
  imports: [FacebookPageModule],
  controllers: [WelcomeScreenController],
  providers: [WelcomeScreenService, MerchantSettingsRepository],
  exports: [FacebookPageModule],
})
export class MessengerProfileModule {}

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [QueueModule, MessengerProfileModule],
  providers: [MessengerProfileProcessor],
})
export class MessengerProfileWorkerModule {}
