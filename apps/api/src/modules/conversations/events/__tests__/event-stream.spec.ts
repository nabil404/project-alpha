import { TestScheduler } from 'rxjs/testing';
import { CONVERSATION_UPDATED_EVENT } from '@app/shared';
import type { ConversationEvent } from '../conversation-event';
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
});
