import { z } from 'zod';

/** Redis pub/sub channel from the worker (and API writes) to every API process's SSE streams. */
export const CONVERSATION_EVENTS_CHANNEL = 'conversation-events';

/**
 * Something changed in one conversation. Ids only, never message text: an SSE
 * client refetches over REST, where tenancy and serialization are tested.
 */
export const conversationEventSchema = z.object({
  merchantId: z.string().min(1),
  conversationId: z.string().uuid(),
  /** `message`: a message was stored or updated. `conversation`: paused, read, or state changed. */
  kind: z.enum(['message', 'conversation']),
});
export type ConversationEvent = z.infer<typeof conversationEventSchema>;
