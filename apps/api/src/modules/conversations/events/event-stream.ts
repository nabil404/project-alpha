import type { MessageEvent } from '@nestjs/common';
import { CONVERSATION_STREAM_EVICTED_EVENT, CONVERSATION_UPDATED_EVENT } from '@app/shared';
import {
  catchError,
  concatWith,
  interval,
  map,
  merge,
  of,
  takeUntil,
  takeWhile,
  throwError,
  timer,
  type Observable,
} from 'rxjs';
import type { ConversationEvent } from './conversation-event';
import { StreamEvicted } from './conversation-events.hub';

/** Under the idle timeouts of common proxies, so an open stream is never cut for silence. */
export const HEARTBEAT_MS = 25_000;
/** How long EventSource waits before reconnecting after a drop. */
export const RETRY_MS = 5_000;

/** Marks the end of `events`, so the merged stream can finish with it. */
const EVENTS_ENDED = Symbol('events ended');

/**
 * One seller's SSE stream: `ready` with the reconnect delay, an id-only
 * `conversation.updated` per change, and `ping` to keep proxies from closing
 * it. It ends when the session expires, so a reconnect must authenticate again,
 * or when `events` completes on shutdown. When the hub evicts it over the
 * per-merchant cap, it sends `evicted` first so the browser doesn't reconnect
 * and evict another tab. Other errors from `events` propagate.
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
    catchError((error: unknown) =>
      error instanceof StreamEvicted
        ? of<MessageEvent>({ type: CONVERSATION_STREAM_EVICTED_EVENT, data: {} })
        : throwError(() => error),
    ),
    concatWith(of(EVENTS_ENDED)),
  );
  const pings = interval(heartbeatMs).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })));
  const remaining = expiresAt.getTime() - now;

  return merge(ready, updates, pings).pipe(
    takeWhile((item): item is MessageEvent => item !== EVENTS_ENDED),
    takeUntil(timer(Math.max(0, remaining))),
  );
}
