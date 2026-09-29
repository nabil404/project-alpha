import { Module } from '@nestjs/common';
import { ConversationRepository } from './conversation.repository';
import { CustomerRepository } from './customer.repository';
import { MessageRepository } from './message.repository';

/**
 * Conversations: the repositories the worker's ingest shares, and (next) the
 * seller-facing API.
 */
@Module({
  providers: [CustomerRepository, ConversationRepository, MessageRepository],
  exports: [CustomerRepository, ConversationRepository, MessageRepository],
})
export class ConversationsModule {}
