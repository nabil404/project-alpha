import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import {
  ConversationThread,
  HandoffReason,
  conversationQueryOptions,
  messagesQueryOptions,
  useConversation,
} from '@/features/conversations';
import { ChatCustomerDetails } from '@/features/customers';
import { ChatOrderBanner, ChatOrderSummary } from '@/features/orders';

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
  const latestOrderId = useConversation(conversationId).data?.latestOrderId;

  // Keyed, so a half-written reply and the scroll position stay with their chat.
  return (
    <div className="flex min-h-0 min-w-0 grow">
      <ConversationThread
        key={conversationId}
        conversationId={conversationId}
        beforeComposer={
          latestOrderId && (
            <ChatOrderBanner
              key={latestOrderId}
              conversationId={conversationId}
              orderId={latestOrderId}
            />
          )
        }
      />
      <ConversationDetails conversationId={conversationId} />
    </div>
  );
}

/**
 * Who the chat is with, the order it produced last and why it needs the
 * seller, beside it on wide screens. Composed here because it draws on three features.
 */
function ConversationDetails({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('conversations');
  const conversation = useConversation(conversationId);
  if (!conversation.data) return null;
  const { customer, latestOrderId } = conversation.data;

  return (
    <aside
      aria-label={t('details.label')}
      className="hidden w-80 shrink-0 flex-col gap-6 overflow-y-auto border-l border-border bg-surface p-6 xl:flex"
    >
      <ChatCustomerDetails customerId={customer.id} />
      {latestOrderId && (
        <>
          <div className="h-px shrink-0 bg-border" />
          <ChatOrderSummary key={latestOrderId} orderId={latestOrderId} />
        </>
      )}
      {conversation.data.handoff && (
        <>
          <div className="h-px shrink-0 bg-border" />
          <HandoffReason conversationId={conversationId} />
        </>
      )}
    </aside>
  );
}
