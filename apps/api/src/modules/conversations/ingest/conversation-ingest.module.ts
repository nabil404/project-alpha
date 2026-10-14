import { Module } from '@nestjs/common';
import { AdProductsModule } from '../../messenger/ads/ad-products.module';
import { FacebookPageModule } from '../../messenger/page/facebook-page.module';
import { QueueModule } from '../../queue/queue.module';
import { SettingsModule } from '../../settings/settings.module';
import { ConversationsModule } from '../conversations.module';
import { ConversationEventsModule } from '../events/conversation-events.module';
import { CustomerProfilesModule } from '../profiles/customer-profiles.module';
import { InboundMessageIngest } from './inbound-message.ingest';
import { InboundMessageProcessor } from './inbound-message.processor';

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [
    QueueModule,
    FacebookPageModule,
    ConversationsModule,
    ConversationEventsModule,
    CustomerProfilesModule,
    SettingsModule,
    AdProductsModule,
  ],
  providers: [InboundMessageIngest, InboundMessageProcessor],
})
export class ConversationIngestModule {}
