import { createFileRoute } from '@tanstack/react-router';

import {
  ConversationThread,
  conversationQueryOptions,
  messagesQueryOptions,
} from '@/features/conversations';

export const Route = createFileRoute('/_app/conversations/$conversationId')({
  loader: ({ context, params: { conversationId } }) =>
    Promise.all([
      context.queryClient.prefetchQuery(conversationQueryOptions(conversationId)),
      context.queryClient.prefetchInfiniteQuery(messagesQueryOptions(conversationId)),
    ]),
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();

  // Keyed, so a half-written reply and the scroll position stay with their chat.
  return <ConversationThread key={conversationId} conversationId={conversationId} />;
}
