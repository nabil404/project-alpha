import { Logger } from '@nestjs/common';
import {
  ConversationEventsHub,
  MAX_STREAMS_PER_MERCHANT,
  StreamEvicted,
} from '../conversation-events.hub';
import type { ConversationEvent } from '../conversation-event';
import type { SubscribeFn } from '../redis-connections';

const A = 'merchant-a';
const B = 'merchant-b';
const CONVO = '6f1c2b1e-4a53-4d4e-9d7a-1b2c3d4e5f60';
const raw = (merchantId: string) =>
  JSON.stringify({ merchantId, conversationId: CONVO, kind: 'message' });

function fakeSubscribe() {
  const state = { connects: 0, closed: 0 };
  const subscribe: SubscribeFn = async () => {
    state.connects++;
    return {
      close: async () => {
        state.closed++;
      },
    };
  };
  return { subscribe, state };
}

describe('ConversationEventsHub', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('connects to Redis on the first stream, and only once', () => {
    const { subscribe, state } = fakeSubscribe();
    const hub = new ConversationEventsHub(subscribe);
    expect(state.connects).toBe(0);

    const first = hub.events(A).subscribe();
    const second = hub.events(B).subscribe();
    expect(state.connects).toBe(1);

    first.unsubscribe();
    second.unsubscribe();
  });

  it("delivers an event only to its own merchant's streams", () => {
    const hub = new ConversationEventsHub(fakeSubscribe().subscribe);
    const seenByA: ConversationEvent[] = [];
    const seenByB: ConversationEvent[] = [];
    const a = hub.events(A).subscribe((event) => seenByA.push(event));
    const b = hub.events(B).subscribe((event) => seenByB.push(event));

    hub.dispatch(raw(A));

    expect(seenByA).toEqual([{ merchantId: A, conversationId: CONVO, kind: 'message' }]);
    expect(seenByB).toEqual([]);
    a.unsubscribe();
    b.unsubscribe();
  });

  it('drops malformed events without throwing', () => {
    const hub = new ConversationEventsHub(fakeSubscribe().subscribe);
    const seen: ConversationEvent[] = [];
    const a = hub.events(A).subscribe((event) => seen.push(event));

    expect(() => hub.dispatch('not json')).not.toThrow();
    hub.dispatch(JSON.stringify({ merchantId: A }));
    hub.dispatch(JSON.stringify({ merchantId: A, conversationId: 'x', kind: 'message' }));

    expect(seen).toEqual([]);
    a.unsubscribe();
  });

  it('stops delivering to a stream once it unsubscribes', () => {
    const hub = new ConversationEventsHub(fakeSubscribe().subscribe);
    const seen: ConversationEvent[] = [];
    hub
      .events(A)
      .subscribe((event) => seen.push(event))
      .unsubscribe();

    hub.dispatch(raw(A));
    expect(seen).toEqual([]);
  });

  describe('the per-merchant stream cap', () => {
    /** Opens `count` streams for merchant A, in order, recording evictions and deliveries per index. */
    function openStreams(hub: ConversationEventsHub, count: number) {
      const evicted: number[] = [];
      const completed: number[] = [];
      const delivered: number[] = [];
      const subscriptions = Array.from({ length: count }, (_, index) =>
        hub.events(A).subscribe({
          next: () => delivered.push(index),
          error: (error: unknown) => {
            if (error instanceof StreamEvicted) evicted.push(index);
          },
          complete: () => completed.push(index),
        }),
      );
      return { evicted, completed, delivered, subscriptions };
    }

    it('ends the oldest stream as evicted and keeps delivering to the other five', () => {
      const hub = new ConversationEventsHub(fakeSubscribe().subscribe);
      const { evicted, completed, delivered, subscriptions } = openStreams(
        hub,
        MAX_STREAMS_PER_MERCHANT + 1,
      );

      // Not a plain completion: the client must be able to tell eviction from a drop.
      expect(evicted).toEqual([0]);
      expect(completed).toEqual([]);
      hub.dispatch(raw(A));
      expect(delivered.sort()).toEqual([1, 2, 3, 4, 5]);
      subscriptions.forEach((subscription) => subscription.unsubscribe());
    });

    it('evicts the next-oldest stream on the following open, not the first one again', () => {
      const hub = new ConversationEventsHub(fakeSubscribe().subscribe);
      const { evicted, delivered, subscriptions } = openStreams(hub, MAX_STREAMS_PER_MERCHANT + 2);

      expect(evicted).toEqual([0, 1]);
      hub.dispatch(raw(A));
      expect(delivered.sort()).toEqual([2, 3, 4, 5, 6]);
      subscriptions.forEach((subscription) => subscription.unsubscribe());
    });

    it('frees the merchant entry once every stream has gone, and a fresh stream works', () => {
      const hub = new ConversationEventsHub(fakeSubscribe().subscribe);
      const { delivered, subscriptions } = openStreams(hub, MAX_STREAMS_PER_MERCHANT + 1);
      expect(hub.streamCount(A)).toBe(MAX_STREAMS_PER_MERCHANT);

      subscriptions.forEach((subscription) => subscription.unsubscribe());
      expect(hub.streamCount(A)).toBe(0);
      hub.dispatch(raw(A));
      expect(delivered).toEqual([]);

      const seen: number[] = [];
      const fresh = hub.events(A).subscribe(() => seen.push(1));
      expect(hub.streamCount(A)).toBe(1);
      hub.dispatch(raw(A));
      expect(seen).toEqual([1]);
      fresh.unsubscribe();
      expect(hub.streamCount(A)).toBe(0);
    });
  });

  it('retries the Redis connection on the next stream after a failed connect', async () => {
    let calls = 0;
    let closed = 0;
    const subscribe: SubscribeFn = async () => {
      calls++;
      if (calls === 1) throw new Error('connect ECONNREFUSED');
      return {
        close: async () => {
          closed++;
        },
      };
    };
    const hub = new ConversationEventsHub(subscribe);
    const seen: ConversationEvent[] = [];

    // The failure is swallowed (an unhandled rejection would fail this test)
    // and leaves the stream open.
    const first = hub.events(A).subscribe((event) => seen.push(event));
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    expect(first.closed).toBe(false);

    // The next stream connects again.
    const second = hub.events(B).subscribe();
    expect(calls).toBe(2);

    await hub.onModuleDestroy();
    expect(closed).toBe(1);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("completes every merchant's open streams on shutdown, so the HTTP server can close", async () => {
    const { subscribe, state } = fakeSubscribe();
    const hub = new ConversationEventsHub(subscribe);
    const completed: string[] = [];
    const streams = [A, A, B].map((merchantId, index) =>
      hub
        .events(merchantId)
        .subscribe({ complete: () => completed.push(`${merchantId}#${index}`) }),
    );

    await hub.onModuleDestroy();

    expect(completed.sort()).toEqual([`${A}#0`, `${A}#1`, `${B}#2`]);
    expect(streams.every((stream) => stream.closed)).toBe(true);
    expect(hub.streamCount(A)).toBe(0);
    expect(hub.streamCount(B)).toBe(0);
    expect(state.closed).toBe(1);
  });

  it('closes the Redis subscription on shutdown', async () => {
    const { subscribe, state } = fakeSubscribe();
    const hub = new ConversationEventsHub(subscribe);
    hub.events(A).subscribe();

    await hub.onModuleDestroy();
    expect(state.closed).toBe(1);
  });
});
