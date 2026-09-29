import { Logger } from '@nestjs/common';
import { ConversationEventsHub, MAX_STREAMS_PER_MERCHANT } from '../conversation-events.hub';
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

  it('closes the oldest stream when a merchant opens one too many', () => {
    const hub = new ConversationEventsHub(fakeSubscribe().subscribe);
    const completed: number[] = [];
    const subscriptions = Array.from({ length: MAX_STREAMS_PER_MERCHANT + 1 }, (_, index) =>
      hub.events(A).subscribe({ complete: () => completed.push(index) }),
    );

    expect(completed).toEqual([0]);
    const seen: number[] = [];
    subscriptions.forEach((subscription) => subscription.unsubscribe());
    hub.events(A).subscribe(() => seen.push(1));
    hub.dispatch(raw(A));
    expect(seen).toEqual([1]);
  });

  it('closes the Redis subscription on shutdown', async () => {
    const { subscribe, state } = fakeSubscribe();
    const hub = new ConversationEventsHub(subscribe);
    hub.events(A).subscribe();

    await hub.onModuleDestroy();
    expect(state.closed).toBe(1);
  });
});
