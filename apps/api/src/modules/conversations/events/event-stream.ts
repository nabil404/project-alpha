import type { MessageEvent } from '@nestjs/common';
import { CONVERSATION_UPDATED_EVENT } from '@app/shared';
import {
  concatWith,
  interval,
  map,
  merge,
  of,
  takeUntil,
  takeWhile,
  timer,
  type Observable,
} from 'rxjs';
import type { ConversationEvent } from './conversation-event';

/** Under the idle timeouts of common proxies, so an open stream is never cut for silence. */
export const HEARTBEAT_MS = 25_000;
/** How long EventSource waits before reconnecting after a drop. */
export const RETRY_MS = 5_000;

/** Marks the end of `events`, so the merged stream can finish with it. */
const EVENTS_ENDED = Symbol('events ended');

/**
 * One seller's SSE stream: a `ready` event carrying the reconnect delay, an
 * id-only `conversation.updated` per change, and a `ping` to keep proxies
 * from closing it. It ends when the session expires, so the browser's
 * reconnect then fails authentication rather than an old stream living on, and
 * when `events` completes (the hub evicting the oldest stream over the
 * per-merchant cap), so an evicted stream closes instead of pinging on stale.
 * `events` is subscribed once; an error from it still propagates.
 */
export function conversationEventStream(
  events: Observable<ConversationEvent>,
  {
    expiresAt,
    heartbeatMs = HEARTBEAT_MS,
    now = Date.now(),
  }: {
    expiresAt: Date;
    heartbeatMs?: number;
    now?: number;
  },
): Observable<MessageEvent> {
  const ready = of<MessageEvent>({ type: 'ready', data: {}, retry: RETRY_MS });
  const updates = events.pipe(
    map((event): MessageEvent => ({
      type: CONVERSATION_UPDATED_EVENT,
      data: { conversationId: event.conversationId },
    })),
    concatWith(of(EVENTS_ENDED)),
  );
  const pings = interval(heartbeatMs).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })));
  const remaining = expiresAt.getTime() - now;

  return merge(ready, updates, pings).pipe(
    takeWhile((item): item is MessageEvent => item !== EVENTS_ENDED),
    takeUntil(timer(Math.max(0, remaining))),
  );
}
