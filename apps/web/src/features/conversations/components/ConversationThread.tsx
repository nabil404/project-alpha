import { useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { Bot, ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConversationDetail } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useConversation, useMarkRead, useUpdateConversation } from '../queries';
import { ConversationStateBadge } from './ConversationStateBadge';
import { CustomerAvatar } from './CustomerAvatar';
import { useCustomerName } from './customer-name';
import { MessageComposer } from './MessageComposer';
import { MessageList } from './MessageList';

/** The assistant answers unless the seller took over, or it handed the chat to them. */
function isAssistantActive(conversation: ConversationDetail): boolean {
  return !conversation.botPaused && conversation.state !== 'handed_off';
}

function isReplyWindowOpen(conversation: ConversationDetail): boolean {
  return (
    conversation.replyWindowClosesAt !== null &&
    new Date(conversation.replyWindowClosesAt).getTime() > Date.now()
  );
}

/** One chat: who it is with, who is answering, the messages and the reply box. */
export function ConversationThread({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('conversations');
  const { forError } = useErrorMessages();
  const conversation = useConversation(conversationId);
  const { mutate: markRead, isPending: markingRead } = useMarkRead(conversationId);
  const unread = conversation.data?.unread ?? false;

  // Opening a chat reads it, and so does a new message arriving while it is open.
  useEffect(() => {
    if (unread && !markingRead) markRead();
  }, [unread, markingRead, markRead]);

  if (conversation.isError) {
    return (
      <div className="flex grow flex-col gap-4 p-4 lg:p-6">
        <BackLink />
        <ErrorBanner>{forError(conversation.error)}</ErrorBanner>
      </div>
    );
  }

  if (!conversation.data) {
    return <div aria-busy className="grow" />;
  }

  const detail = conversation.data;
  const assistantActive = isAssistantActive(detail);

  return (
    <div className="flex min-h-0 min-w-0 grow">
      <div className="flex min-h-0 min-w-0 grow flex-col">
        <ThreadHeader conversation={detail} assistantActive={assistantActive} />
        <MessageList conversationId={conversationId} />
        <MessageComposer
          conversationId={conversationId}
          customerName={detail.customer.name ?? t('customer.unknownName')}
          assistantActive={assistantActive}
          windowOpen={isReplyWindowOpen(detail)}
        />
      </div>
      <CustomerPanel conversation={detail} />
    </div>
  );
}

function BackLink({ className }: { className?: string }) {
  const { t } = useTranslation('conversations');

  return (
    <Button asChild variant="ghost" size="icon" className={cn('size-11', className)}>
      <Link to="/conversations" search={(prev) => prev} aria-label={t('thread.back')}>
        <ChevronLeft aria-hidden className="size-6" strokeWidth={1.5} />
      </Link>
    </Button>
  );
}

function ThreadHeader({
  conversation,
  assistantActive,
}: {
  conversation: ConversationDetail;
  assistantActive: boolean;
}) {
  const { t } = useTranslation('conversations');
  const { forError } = useErrorMessages();
  const customerName = useCustomerName();
  const update = useUpdateConversation(conversation.id);
  const modeLabel = assistantActive ? t('thread.mode.assistant') : t('thread.mode.seller');
  const toggle = (
    <Button
      disabled={update.isPending}
      onClick={() => update.mutate({ botPaused: assistantActive })}
      className="max-sm:h-8 max-sm:px-3 max-sm:text-label"
    >
      {assistantActive ? t('thread.takeOver') : t('thread.handBack')}
    </Button>
  );

  return (
    <>
      <header className="flex items-center gap-1 border-b border-border bg-surface px-2 py-2 sm:gap-3 lg:px-6 lg:py-4">
        <BackLink className="lg:hidden" />
        <CustomerAvatar
          name={conversation.customer.name}
          pictureUrl={conversation.customer.pictureUrl}
          className="max-sm:hidden"
        />
        <h2 className="min-w-0 grow truncate text-heading">
          {customerName(conversation.customer.name)}
        </h2>
        <span className="flex items-center gap-3 max-sm:hidden">
          <ModePill assistantActive={assistantActive} label={modeLabel} />
          {toggle}
        </span>
      </header>

      {/* Below `sm` the mode and its switch get a row of their own, as in Messenger. */}
      <div
        className={cn(
          'flex items-center gap-2 border-b border-border px-4 py-2 sm:hidden',
          assistantActive ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning',
        )}
      >
        <Bot aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
        <span className="grow text-label">{modeLabel}</span>
        {toggle}
      </div>

      {update.isError && (
        <ErrorBanner className="mx-4 mt-3 lg:mx-6">{forError(update.error)}</ErrorBanner>
      )}
    </>
  );
}

function ModePill({ assistantActive, label }: { assistantActive: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-label whitespace-nowrap',
        assistantActive ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning',
      )}
    >
      <Bot aria-hidden className="size-3.5" strokeWidth={1.5} />
      {label}
    </span>
  );
}

/** Who the seller is talking to, beside the thread on wide screens. */
function CustomerPanel({ conversation }: { conversation: ConversationDetail }) {
  const { t } = useTranslation('conversations');
  const { formatDate } = useFormatters();
  const customerName = useCustomerName();
  const windowOpen = isReplyWindowOpen(conversation);

  return (
    <aside
      aria-label={t('customer.title')}
      className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-6 xl:flex"
    >
      <h2 className="text-heading">{t('customer.title')}</h2>
      <div className="flex items-center gap-3">
        <CustomerAvatar
          name={conversation.customer.name}
          pictureUrl={conversation.customer.pictureUrl}
        />
        <span className="min-w-0 truncate text-body font-medium">
          {customerName(conversation.customer.name)}
        </span>
      </div>
      <div className="flex">
        <ConversationStateBadge state={conversation.state} />
      </div>
      <p className="text-small text-ink-muted">
        {windowOpen && conversation.replyWindowClosesAt
          ? t('customer.replyUntil', {
              time: formatDate(conversation.replyWindowClosesAt, 'dateTime'),
            })
          : t('customer.replyWindowClosed')}
      </p>
    </aside>
  );
}
