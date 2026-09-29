import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app.config';
import { ConversationEventsHub } from './conversation-events.hub';
import { ConversationEventsPublisher } from './conversation-events.publisher';
import {
  CONVERSATION_EVENTS_REDIS,
  CONVERSATION_EVENTS_SUBSCRIBE,
  publisherConnection,
  redisSubscribe,
} from './redis-connections';

/** Imported by the ingest (publisher only) and the conversations API (both). */
@Module({
  providers: [
    ConversationEventsPublisher,
    ConversationEventsHub,
    {
      provide: CONVERSATION_EVENTS_REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => publisherConnection(config.get('REDIS_URL')),
    },
    {
      provide: CONVERSATION_EVENTS_SUBSCRIBE,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => redisSubscribe(config.get('REDIS_URL')),
    },
  ],
  exports: [ConversationEventsPublisher, ConversationEventsHub],
})
export class ConversationEventsModule {}
