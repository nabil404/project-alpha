import { Module } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto.service';
import { FacebookPageModule } from '../../messenger/page/facebook-page.module';
import { QueueModule } from '../../queue/queue.module';
import { ConversationsModule } from '../conversations.module';
import { ConversationEventsModule } from '../events/conversation-events.module';
import { InboundMessageIngest } from './inbound-message.ingest';
import { InboundMessageProcessor } from './inbound-message.processor';

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [QueueModule, FacebookPageModule, ConversationsModule, ConversationEventsModule],
  providers: [CryptoService, InboundMessageIngest, InboundMessageProcessor],
})
export class ConversationIngestModule {}
