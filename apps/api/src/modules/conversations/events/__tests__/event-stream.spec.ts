import { TestScheduler } from 'rxjs/testing';
import { CONVERSATION_STREAM_EVICTED_EVENT, CONVERSATION_UPDATED_EVENT } from '@app/shared';
import type { ConversationEvent } from '../conversation-event';
import { StreamEvicted } from '../conversation-events.hub';
import { RETRY_MS, conversationEventStream } from '../event-stream';

const CONVO = '6f1c2b1e-4a53-4d4e-9d7a-1b2c3d4e5f60';

describe('conversationEventStream', () => {
  it('opens with a retry hint, forwards ids only, pings, and ends when the session expires', () => {
    const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    scheduler.run(({ cold, expectObservable }) => {
      const event: ConversationEvent = { merchantId: 'm', conversationId: CONVO, kind: 'message' };
      const events = cold<ConversationEvent>('5ms a', { a: event });

      const stream = conversationEventStream(events, {
        expiresAt: new Date(35),
        heartbeatMs: 10,
        now: 0,
      });

      expectObservable(stream).toBe('r 4ms u 4ms p 9ms p 9ms p 4ms |', {
        r: { type: 'ready', data: {}, retry: RETRY_MS },
        u: { type: CONVERSATION_UPDATED_EVENT, data: { conversationId: CONVO } },
        p: { type: 'ping', data: {} },
      });
    });
  });

  it('ends at once for a session that has already expired', () => {
    const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    scheduler.run(({ cold, expectObservable }) => {
      const stream = conversationEventStream(cold<ConversationEvent>('-'), {
        expiresAt: new Date(0),
        heartbeatMs: 10,
        now: 100,
      });
      expectObservable(stream).toBe('(r|)', { r: { type: 'ready', data: {}, retry: RETRY_MS } });
    });
  });

  it('ends when the events complete, as on shutdown', () => {
    const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    scheduler.run(({ cold, expectObservable }) => {
      const event: ConversationEvent = { merchantId: 'm', conversationId: CONVO, kind: 'message' };
      const events = cold<ConversationEvent>('5ms a 2ms |', { a: event });

      const stream = conversationEventStream(events, {
        expiresAt: new Date(1_000),
        heartbeatMs: 6,
        now: 0,
      });

      // No ping at 12: the stream is gone at 8, well before the session expires.
      expectObservable(stream).toBe('r 4ms u p 1ms |', {
        r: { type: 'ready', data: {}, retry: RETRY_MS },
        u: { type: CONVERSATION_UPDATED_EVENT, data: { conversationId: CONVO } },
        p: { type: 'ping', data: {} },
      });
    });
  });

  it('tells the client it was evicted, then ends', () => {
    const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    scheduler.run(({ cold, expectObservable }) => {
      const events = cold<ConversationEvent>('5ms #', undefined, new StreamEvicted());

      const stream = conversationEventStream(events, {
        expiresAt: new Date(1_000),
        heartbeatMs: 100,
        now: 0,
      });

      expectObservable(stream).toBe('r 4ms (e|)', {
        r: { type: 'ready', data: {}, retry: RETRY_MS },
        e: { type: CONVERSATION_STREAM_EVICTED_EVENT, data: {} },
      });
    });
  });

  it('still fails with the error when the events error', () => {
    const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    scheduler.run(({ cold, expectObservable }) => {
      const boom = new Error('boom');
      const stream = conversationEventStream(cold<ConversationEvent>('5ms #', undefined, boom), {
        expiresAt: new Date(1_000),
        heartbeatMs: 100,
        now: 0,
      });
      expectObservable(stream).toBe(
        'r 4ms #',
        { r: { type: 'ready', data: {}, retry: RETRY_MS } },
        boom,
      );
    });
  });

  it('subscribes to the events exactly once, and unsubscribes when the stream ends', () => {
    const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    scheduler.run(({ cold, expectObservable, expectSubscriptions }) => {
      const events = cold<ConversationEvent>('-');

      const stream = conversationEventStream(events, {
        expiresAt: new Date(20),
        heartbeatMs: 100,
        now: 0,
      });

      expectObservable(stream).toBe('r 19ms |', {
        r: { type: 'ready', data: {}, retry: RETRY_MS },
      });
      expectSubscriptions(events.subscriptions).toBe('^ 19ms !');
    });
  });
});
