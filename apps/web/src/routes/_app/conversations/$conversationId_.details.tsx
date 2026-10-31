import { createFileRoute } from '@tanstack/react-router';

import {
  ConversationDetailsHeader,
  HandoffReason,
  conversationQueryOptions,
  useConversation,
} from '@/features/conversations';
import { ChatCustomerDetails } from '@/features/customers';
import { ChatOrderSummary } from '@/features/orders';

/**
 * The chat's customer and latest order as a screen of their own, for widths
 * where they don't fit beside the thread. Not nested under the chat's route,
 * so it takes the chat's place rather than sitting inside it.
 */
export const Route = createFileRoute('/_app/conversations/$conversationId_/details')({
  loader: ({ context, params: { conversationId } }) =>
    context.queryClient.prefetchQuery(conversationQueryOptions(conversationId)),
  component: ConversationDetailsPage,
});

const card = 'rounded-lg border border-border bg-surface p-4 shadow-card';

function ConversationDetailsPage() {
  const { conversationId } = Route.useParams();
  const conversation = useConversation(conversationId);

  return (
    <div className="flex min-h-0 min-w-0 grow flex-col">
      <ConversationDetailsHeader conversationId={conversationId} />
      {conversation.data && (
        <main className="flex min-h-0 grow flex-col gap-4 overflow-y-auto px-4 pt-4 pb-8 lg:mx-auto lg:w-full lg:max-w-xl lg:pt-6">
          <div className={card}>
            <ChatCustomerDetails customerId={conversation.data.customer.id} />
          </div>
          {conversation.data.latestOrderId && (
            <div className={card}>
              <ChatOrderSummary
                key={conversation.data.latestOrderId}
                orderId={conversation.data.latestOrderId}
              />
            </div>
          )}
          {conversation.data.handoff && (
            <div className={card}>
              <HandoffReason conversationId={conversationId} />
            </div>
          )}
        </main>
      )}
    </div>
  );
}
