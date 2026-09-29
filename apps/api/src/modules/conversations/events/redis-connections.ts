import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONVERSATION_EVENTS_CHANNEL } from './conversation-event';

export const CONVERSATION_EVENTS_REDIS = Symbol('CONVERSATION_EVENTS_REDIS');
export const CONVERSATION_EVENTS_SUBSCRIBE = Symbol('CONVERSATION_EVENTS_SUBSCRIBE');

export type RedisPublisher = Pick<Redis, 'publish' | 'disconnect'>;

export interface EventSubscription {
  close(): Promise<void>;
}

/** Subscribes to the conversation channel and hands each raw message to `onMessage`. */
export type SubscribeFn = (onMessage: (raw: string) => void) => Promise<EventSubscription>;

const logger = new Logger('ConversationEventsRedis');

/**
 * Lazy: nothing connects until the first publish, so booting a module (or a
 * test) never needs Redis. One retry per command bounds how long a Redis
 * outage can hold up the ingest job that is publishing.
 */
export function publisherConnection(url: string): Redis {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', (error: Error) => logger.warn(`Publisher connection: ${error.message}`));
  return redis;
}

/**
 * A dedicated connection: one in subscriber mode can run no other command.
 * ioredis reconnects and resubscribes on its own after a drop.
 */
export function redisSubscribe(url: string): SubscribeFn {
  return async (onMessage) => {
    // disconnectTimeout 0: disconnect() on a socket that already dropped would
    // otherwise leave ioredis' 2s "destroy it if still open" timer holding the process.
    const redis = new Redis(url, { lazyConnect: true, disconnectTimeout: 0 });
    redis.on('error', (error: Error) => logger.warn(`Subscriber connection: ${error.message}`));
    redis.on('message', (channel: string, message: string) => {
      if (channel === CONVERSATION_EVENTS_CHANNEL) onMessage(message);
    });
    try {
      // connect() rejects on the first failed attempt, but the client would keep
      // reconnecting in the background: drop it so a retry starts from scratch.
      await redis.connect();
      await redis.subscribe(CONVERSATION_EVENTS_CHANNEL);
    } catch (error) {
      redis.disconnect();
      throw error;
    }
    return {
      close: async () => {
        redis.disconnect();
      },
    };
  };
}
