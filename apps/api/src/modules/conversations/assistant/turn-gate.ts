import type { ConversationState, MessageKind, MessageSender } from '@app/shared';

export type TurnGate = 'go' | 'paused' | 'closed' | 'stale' | 'answered';

/** What the gate reads of each message. */
export interface GateMessage {
  id: string;
  sender: MessageSender;
  kind: MessageKind;
  sentAt: Date;
  editedAt: Date | null;
}

/** When the trigger last asked: its latest edit, else when it was sent. A reply answers it only after this. */
export function askedAt(trigger: Pick<GateMessage, 'sentAt' | 'editedAt'>): Date {
  return trigger.editedAt ?? trigger.sentAt;
}

/**
 * Whether a turn may still answer its trigger, checked before the LLM and
 * again under the lock. `newestFirst` is the conversation's recent messages.
 * "answered" is what makes a retried job safe: its reply is already stored.
 * A reaction never makes a message's turn stale; only a newer reaction makes
 * a reaction's stale.
 */
export function turnGate(
  conversation: { botPaused: boolean; state: ConversationState },
  newestFirst: GateMessage[],
  triggerMessageId: string,
): TurnGate {
  if (conversation.botPaused) return 'paused';
  if (conversation.state === 'handed_off' || conversation.state === 'confirmed') return 'closed';
  const index = newestFirst.findIndex((message) => message.id === triggerMessageId);
  const trigger = newestFirst[index];
  if (!trigger) return 'stale';
  const superseded = newestFirst
    .slice(0, index)
    .some(
      (message) =>
        message.sender === 'customer' &&
        (message.kind !== 'reaction' || trigger.kind === 'reaction'),
    );
  if (superseded) return 'stale';
  const asked = askedAt(trigger);
  const replied = newestFirst.some(
    (message) => message.sender !== 'customer' && message.sentAt > asked,
  );
  return replied ? 'answered' : 'go';
}

/** Days of silence from the shop after which a customer's new message starts the order over. */
export const STALE_CHAT_DAYS = 10;
const STALE_CHAT_MS = STALE_CHAT_DAYS * 24 * 60 * 60 * 1000;

/**
 * The shop's newest message before the trigger, when the trigger came
 * STALE_CHAT_DAYS or more after it; otherwise null. The customer's own burst
 * is looked past, so a run of "hi"s is measured from the shop's last reply.
 */
export function staleReply<T extends GateMessage>(
  newestFirst: T[],
  triggerMessageId: string,
): T | null {
  const index = newestFirst.findIndex((message) => message.id === triggerMessageId);
  const trigger = newestFirst[index];
  if (!trigger) return null;
  const reply = newestFirst.slice(index + 1).find((message) => message.sender !== 'customer');
  if (!reply) return null;
  return askedAt(trigger).getTime() - reply.sentAt.getTime() >= STALE_CHAT_MS ? reply : null;
}
