import type { ConversationState, MessageSender } from '@app/shared';

export type TurnGate = 'go' | 'paused' | 'closed' | 'stale' | 'answered';

/**
 * Whether a turn may still answer its trigger, checked before the LLM and
 * again under the lock. `newestFirst` is the conversation's recent messages.
 * "answered" is what makes a retried job safe: its reply is already stored.
 */
export function turnGate(
  conversation: { botPaused: boolean; state: ConversationState },
  newestFirst: { id: string; sender: MessageSender; sentAt: Date }[],
  triggerMessageId: string,
): TurnGate {
  if (conversation.botPaused) return 'paused';
  if (conversation.state === 'handed_off' || conversation.state === 'confirmed') return 'closed';
  const trigger = newestFirst.find((message) => message.id === triggerMessageId);
  const latestCustomer = newestFirst.find((message) => message.sender === 'customer');
  if (!trigger || latestCustomer?.id !== trigger.id) return 'stale';
  const replied = newestFirst.some(
    (message) => message.sender !== 'customer' && message.sentAt > trigger.sentAt,
  );
  return replied ? 'answered' : 'go';
}
