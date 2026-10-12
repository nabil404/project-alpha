import { useEffect, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Bot, ChevronLeft, ChevronRight, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConversationDetail } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { useConversation, useMarkRead, useUpdateConversation } from '../queries';
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

/**
 * One chat: who it is with, who is answering, the messages and the reply box.
 * `beforeComposer` sits between the messages and the reply box.
 */
export function ConversationThread({
  conversationId,
  beforeComposer,
}: {
  conversationId: string;
  beforeComposer?: ReactNode;
}) {
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
    <div className="flex min-h-0 min-w-0 grow flex-col">
      <ThreadHeader conversation={detail} assistantActive={assistantActive} />
      <MessageList conversationId={conversationId} />
      {beforeComposer}
      <MessageComposer
        conversationId={conversationId}
        customerName={detail.customer.name ?? t('customer.unknownName')}
        assistantActive={assistantActive}
        windowOpen={isReplyWindowOpen(detail)}
      />
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
  const toast = useToast();
  const customerName = useCustomerName();
  const update = useUpdateConversation(conversation.id);
  const modeLabel = assistantActive ? t('thread.mode.assistant') : t('thread.mode.seller');
  const toggle = (
    <Button
      disabled={update.isPending}
      // A toast, not a banner: on a phone a banner pushes the whole thread down.
      onClick={() => update.mutate({ botPaused: assistantActive }, { onError: toast.error })}
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
        {/* From `xl` up the details sit beside the thread instead. */}
        <Button asChild variant="ghost" size="icon" className="size-11 xl:hidden">
          <Link
            to="/conversations/$conversationId/details"
            params={{ conversationId: conversation.id }}
            search={(prev) => prev}
            aria-label={t('thread.details')}
          >
            <UserRound aria-hidden className="size-6" strokeWidth={1.5} />
          </Link>
        </Button>
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

/** The Details screen's header: back to the chat, and where it sits. */
export function ConversationDetailsHeader({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('conversations');
  const customerName = useCustomerName();
  const conversation = useConversation(conversationId);
  const name = conversation.data ? customerName(conversation.data.customer.name) : '';

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
        <Button asChild variant="ghost" size="icon" className="size-11">
          <Link
            to="/conversations/$conversationId"
            params={{ conversationId }}
            search={(prev) => prev}
            aria-label={t('details.back')}
          >
            <ChevronLeft aria-hidden className="size-6" strokeWidth={1.5} />
          </Link>
        </Button>
        <h1 className="min-w-0 grow truncate text-heading">{t('details.title')}</h1>
      </header>
      <nav
        aria-label={t('details.breadcrumb')}
        className="shrink-0 border-b border-border bg-surface px-4 py-2"
      >
        <ol className="flex min-w-0 items-center gap-1 text-small text-ink-muted">
          <li className="shrink-0">
            <Link to="/conversations" search={(prev) => prev} className="hover:text-ink">
              {t('list.title')}
            </Link>
          </li>
          <li aria-hidden className="flex">
            <ChevronRight strokeWidth={1.5} className="size-3.5" />
          </li>
          <li className="min-w-0 truncate">
            <Link
              to="/conversations/$conversationId"
              params={{ conversationId }}
              search={(prev) => prev}
              className="hover:text-ink"
            >
              {name}
            </Link>
          </li>
          <li aria-hidden className="flex">
            <ChevronRight strokeWidth={1.5} className="size-3.5" />
          </li>
          <li aria-current="page" className="shrink-0 font-medium text-ink">
            {t('details.title')}
          </li>
        </ol>
      </nav>
    </>
  );
}
