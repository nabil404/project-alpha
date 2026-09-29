import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { CONVERSATION_EVENTS_CHANNEL, type ConversationEvent } from './conversation-event';
import { CONVERSATION_EVENTS_REDIS, type RedisPublisher } from './redis-connections';

/**
 * Called after a commit, never inside a transaction. A failure is logged and
 * swallowed: the data is stored, and every client refetches when its stream
 * reopens.
 */
@Injectable()
export class ConversationEventsPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationEventsPublisher.name);

  constructor(@Inject(CONVERSATION_EVENTS_REDIS) private readonly redis: RedisPublisher) {}

  async publish(event: ConversationEvent): Promise<void> {
    try {
      await this.redis.publish(CONVERSATION_EVENTS_CHANNEL, JSON.stringify(event));
    } catch (error) {
      this.logger.warn(
        `Conversation event not published: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
