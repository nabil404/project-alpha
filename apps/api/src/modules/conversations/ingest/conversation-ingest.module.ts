import { Module } from '@nestjs/common';
import { AdProductRepository } from '../../messenger/ads/ad-product.repository';
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
  ],
  providers: [AdProductRepository, InboundMessageIngest, InboundMessageProcessor],
})
export class ConversationIngestModule {}
