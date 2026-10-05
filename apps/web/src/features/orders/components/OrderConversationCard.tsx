import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { messagesQueryOptions } from '@/features/conversations';
import { useStatusLabels } from '@/i18n/status-keys';
import { cn } from '@/lib/utils';

const PREVIEW_MESSAGES = 3;

/** The chat the order came from: its latest messages, and the way to it. */
export function OrderConversationCard({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('orders');
  const { messageSender } = useStatusLabels();
  const messages = useInfiniteQuery(messagesQueryOptions(conversationId));
  // The first page holds the newest messages, oldest first within it.
  const latest = messages.data?.pages[0]?.data.slice(-PREVIEW_MESSAGES) ?? [];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-heading">{t('conversation.title')}</h2>
        <Link
          to="/conversations/$conversationId"
          params={{ conversationId }}
          className="text-small font-medium text-link underline-offset-4 hover:underline"
        >
          {t('conversation.open')}
        </Link>
      </div>
      {messages.isPending ? (
        <span aria-hidden className="h-24 animate-pulse rounded-md bg-surface-sunken" />
      ) : messages.isError || latest.length === 0 ? (
        <p className="text-small text-ink-muted">{t('conversation.unavailable')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {latest.map((message) => (
            <li
              key={message.id}
              className={cn(
                'flex max-w-[90%] flex-col gap-0.5 rounded-lg px-3 py-2',
                message.sender === 'customer'
                  ? 'self-start bg-surface-sunken'
                  : 'self-end bg-accent-soft',
              )}
            >
              <span className="text-label text-ink-muted">{messageSender(message.sender)}</span>
              <p className="text-small break-words whitespace-pre-line">{message.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
