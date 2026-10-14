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
