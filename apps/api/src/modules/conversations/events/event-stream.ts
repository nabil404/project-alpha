import type { MessageEvent } from '@nestjs/common';
import { CONVERSATION_UPDATED_EVENT } from '@app/shared';
import { interval, map, merge, of, takeUntil, timer, type Observable } from 'rxjs';
import type { ConversationEvent } from './conversation-event';

/** Under the idle timeouts of common proxies, so an open stream is never cut for silence. */
export const HEARTBEAT_MS = 25_000;
/** How long EventSource waits before reconnecting after a drop. */
export const RETRY_MS = 5_000;

/**
 * One seller's SSE stream: a `ready` event carrying the reconnect delay, an
 * id-only `conversation.updated` per change, and a `ping` to keep proxies
 * from closing it. It ends when the session expires, so the browser's
 * reconnect then fails authentication rather than an old stream living on.
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
  );
  const pings = interval(heartbeatMs).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })));
  const remaining = expiresAt.getTime() - now;

  return merge(ready, updates, pings).pipe(takeUntil(timer(Math.max(0, remaining))));
}
