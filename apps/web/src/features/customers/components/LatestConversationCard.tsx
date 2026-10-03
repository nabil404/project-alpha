import { Link } from '@tanstack/react-router';
import { PauseCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CustomerDetail } from '@app/shared';

import { ConversationStateBadge } from '@/features/conversations';
import { useStatusLabels } from '@/i18n/status-keys';
import { useFormatters } from '@/lib/format';

/** The customer's most recently active chat: its last message, and where it stands. */
export function LatestConversationCard({
  conversation,
}: {
  conversation: CustomerDetail['latestConversation'];
}) {
  const { t } = useTranslation('customers');
  const { messageSender } = useStatusLabels();
  const { formatDate } = useFormatters();

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-heading">{t('conversation.title')}</h2>
        {conversation && (
          <Link
            to="/conversations/$conversationId"
            params={{ conversationId: conversation.id }}
            className="text-small font-medium text-link underline-offset-4 hover:underline"
          >
            {t('conversation.open')}
          </Link>
        )}
      </div>

      {conversation ? (
        <>
          <div className="flex flex-col gap-1 rounded-md bg-surface-sunken px-4 py-3">
            <span className="flex flex-wrap items-center justify-between gap-2 text-small text-ink-muted">
              <span>
                {t('conversation.meta', {
                  sender: messageSender(conversation.lastMessage.sender),
                  at: formatDate(conversation.lastMessage.at, 'dateTime'),
                })}
              </span>
              <ConversationStateBadge state={conversation.state} />
            </span>
            <p className="text-body break-words">{conversation.lastMessage.preview}</p>
          </div>
          {conversation.botPaused && (
            <p className="flex items-center gap-2 text-small text-ink-muted">
              <PauseCircle aria-hidden strokeWidth={1.5} className="size-4 shrink-0" />
              {t('conversation.botPaused')}
            </p>
          )}
        </>
      ) : (
        <p className="text-body text-ink-muted">{t('conversation.none')}</p>
      )}
    </section>
  );
}
