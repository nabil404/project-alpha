import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import { FacebookPageModule } from '../messenger/page/facebook-page.module';
import { ConversationRepository } from './conversation.repository';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { CustomerRepository } from './customer.repository';
import { ConversationEventsModule } from './events/conversation-events.module';
import { MessageRepository } from './message.repository';

/**
 * The seller-facing conversations API, and the repositories the worker's
 * ingest (ConversationIngestModule) shares.
 */
@Module({
  imports: [FacebookPageModule, ConversationEventsModule],
  controllers: [ConversationsController],
  providers: [
    CryptoService,
    CustomerRepository,
    ConversationRepository,
    MessageRepository,
    ConversationsService,
  ],
  exports: [CustomerRepository, ConversationRepository, MessageRepository],
})
export class ConversationsModule {}
