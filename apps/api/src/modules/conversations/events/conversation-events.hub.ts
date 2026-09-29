import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Observable, type Subscriber } from 'rxjs';
import { conversationEventSchema, type ConversationEvent } from './conversation-event';
import {
  CONVERSATION_EVENTS_SUBSCRIBE,
  type EventSubscription,
  type SubscribeFn,
} from './redis-connections';

/** Open streams one merchant may hold; the oldest closes when another opens. Guards against leaked tabs. */
export const MAX_STREAMS_PER_MERCHANT = 5;

/**
 * Fans the Redis channel out to each merchant's open SSE streams. It connects
 * on the first stream, not at boot: WorkerModule imports AppModule, so the hub
 * exists in the worker too, where it must never open a subscriber.
 */
@Injectable()
export class ConversationEventsHub implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationEventsHub.name);
  /** Oldest first. */
  private readonly streams = new Map<string, Subscriber<ConversationEvent>[]>();
  private subscription: Promise<EventSubscription | null> | null = null;

  constructor(@Inject(CONVERSATION_EVENTS_SUBSCRIBE) private readonly subscribe: SubscribeFn) {}

  events(merchantId: string): Observable<ConversationEvent> {
    return new Observable<ConversationEvent>((subscriber) => {
      this.connect();
      const list = this.streams.get(merchantId) ?? [];
      this.streams.set(merchantId, list);
      list.push(subscriber);
      if (list.length > MAX_STREAMS_PER_MERCHANT) {
        list[0]?.complete();
      }
      return () => {
        const index = list.indexOf(subscriber);
        if (index >= 0) list.splice(index, 1);
        if (list.length === 0 && this.streams.get(merchantId) === list) {
          this.streams.delete(merchantId);
        }
      };
    });
  }

  /** Open streams for one merchant. Lets tests prove a closed stream leaves nothing behind. */
  streamCount(merchantId: string): number {
    return this.streams.get(merchantId)?.length ?? 0;
  }

  /** One raw channel message. Anything that is not a valid event is dropped. */
  dispatch(raw: string): void {
    let event: ConversationEvent;
    try {
      const parsed = conversationEventSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error('invalid shape');
      event = parsed.data;
    } catch {
      this.logger.warn('Dropped a malformed conversation event');
      return;
    }
    for (const subscriber of [...(this.streams.get(event.merchantId) ?? [])]) {
      subscriber.next(event);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const subscription = await this.subscription;
    await subscription?.close();
  }

  private connect(): void {
    this.subscription ??= this.subscribe((raw) => this.dispatch(raw)).catch((error: unknown) => {
      this.logger.error(
        `Conversation events subscriber failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      // The next stream tries again.
      this.subscription = null;
      return null;
    });
  }
}
