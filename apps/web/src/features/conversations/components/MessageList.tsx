import { Fragment, useLayoutEffect, useRef } from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Message, MessageSender, MessageStatus } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  useFailedMessageActions,
  useLocalMessages,
  useMessages,
  type LocalMessage,
} from '../queries';

/** Within this many pixels of the bottom, a new message scrolls into view. */
const STICK_TO_BOTTOM_PX = 80;

/** How far a stored `sending` row may predate its local copy's submit and still be that copy. */
const SAME_REPLY_SKEW_MS = 60_000;

/** One bubble: a stored message, or a reply that so far exists only in this browser. */
interface ThreadItem {
  key: string;
  text: string;
  sender: MessageSender;
  sentAt: string;
  status: MessageStatus;
  /** Set on a local reply; retry and remove act on it. */
  local?: LocalMessage;
}

/**
 * Stored messages, then local replies in the order written. A live update can
 * land the API's `sending` row for a reply still in flight here; that row
 * stands in for the local copy rather than showing it twice.
 */
function threadItems(messages: Message[], local: LocalMessage[]): ThreadItem[] {
  const claimed = new Set<string>();
  const items: ThreadItem[] = messages.map((message) => ({ key: message.id, ...message }));

  for (const reply of local) {
    const stored =
      reply.status === 'sending'
        ? messages.find(
            (message) =>
              !claimed.has(message.id) &&
              message.sender === 'seller' &&
              message.status === 'sending' &&
              message.text === reply.text &&
              new Date(message.sentAt).getTime() >= reply.submittedAt - SAME_REPLY_SKEW_MS,
          )
        : undefined;
    if (stored) {
      claimed.add(stored.id);
      continue;
    }
    items.push({
      key: `local-${reply.mutationId}`,
      text: reply.text,
      sender: 'seller',
      sentAt: new Date(reply.submittedAt || Date.now()).toISOString(),
      status: reply.status,
      local: reply,
    });
  }
  return items;
}

/**
 * The thread, oldest first, opened at the newest message. A new message at the
 * bottom scrolls into view only when the seller is already reading there, or
 * when it is a reply they just sent; loading earlier messages keeps what they
 * were reading in place.
 */
export function MessageList({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('conversations');
  const { forError } = useErrorMessages();
  const messagesQuery = useMessages(conversationId);
  const local = useLocalMessages(conversationId);
  const stored =
    messagesQuery.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.data) ?? [];
  const messages = threadItems(stored, local);

  const scrollRef = useRef<HTMLDivElement>(null);
  const previous = useRef<{ firstId?: string; lastId?: string; height: number; atBottom: boolean }>(
    { height: 0, atBottom: true },
  );
  const firstId = messages[0]?.key;
  const lastId = messages.at(-1)?.key;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const before = previous.current;

    if (firstId !== before.firstId && lastId === before.lastId) {
      element.scrollTop += element.scrollHeight - before.height;
    } else if (lastId !== before.lastId && (before.atBottom || lastId?.startsWith('local-'))) {
      element.scrollTop = element.scrollHeight;
    }
    previous.current = {
      firstId,
      lastId,
      height: element.scrollHeight,
      atBottom: before.atBottom || element.scrollTop + element.clientHeight >= element.scrollHeight,
    };
  }, [firstId, lastId]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    previous.current.atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < STICK_TO_BOTTOM_PX;
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 grow overflow-y-auto">
      <div className="flex min-h-full flex-col justify-end gap-3 p-4 lg:gap-4 lg:p-6">
        {messagesQuery.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            disabled={messagesQuery.isFetchingNextPage}
            onClick={() => void messagesQuery.fetchNextPage()}
          >
            {t('thread.loadOlder')}
          </Button>
        )}

        {messagesQuery.isError ? (
          <ErrorBanner>{forError(messagesQuery.error)}</ErrorBanner>
        ) : messagesQuery.isSuccess && messages.length === 0 ? (
          <p className="self-center text-small text-ink-muted">{t('thread.empty')}</p>
        ) : (
          messages.map((message, index) => (
            <Fragment key={message.key}>
              {!sameDay(messages[index - 1]?.sentAt, message.sentAt) && (
                <DaySeparator at={message.sentAt} />
              )}
              <MessageBubble conversationId={conversationId} message={message} />
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}

function sameDay(a: string | undefined, b: string): boolean {
  return a !== undefined && new Date(a).toDateString() === new Date(b).toDateString();
}

function DaySeparator({ at }: { at: string }) {
  const { t } = useTranslation('conversations');
  const { formatDate } = useFormatters();
  const today = new Date().toDateString() === new Date(at).toDateString();

  return (
    <div className="self-center text-small text-ink-muted">
      {today ? t('thread.today') : formatDate(at)}
    </div>
  );
}

function MessageBubble({
  conversationId,
  message,
}: {
  conversationId: string;
  message: ThreadItem;
}) {
  const { t } = useTranslation('conversations');
  const { formatDate } = useFormatters();
  const { messageSender, messageStatus } = useStatusLabels();
  const inbound = message.sender === 'customer';
  const time = formatDate(message.sentAt, 'time');
  const failed = message.status === 'failed';

  return (
    <div
      className={cn(
        'flex max-w-[82%] flex-col gap-1 lg:max-w-[70%]',
        inbound ? 'items-start self-start' : 'items-end self-end',
      )}
    >
      <div
        className={cn(
          'rounded-lg px-3.5 py-2.5 text-body break-words whitespace-pre-wrap',
          inbound
            ? 'rounded-bl-sm border border-border bg-surface'
            : 'rounded-br-sm bg-accent-soft',
          failed && 'border border-danger',
          message.status === 'sending' && 'opacity-70',
        )}
      >
        {message.text}
      </div>
      <span className="flex items-center gap-1 text-small text-ink-muted">
        {message.sender === 'assistant' && (
          <Bot aria-hidden className="size-3.5" strokeWidth={1.5} />
        )}
        <time dateTime={message.sentAt}>
          {inbound ? time : t('thread.sender', { sender: messageSender(message.sender), time })}
        </time>
        {message.status !== 'sent' && (
          <span className={cn(failed && 'text-danger')}>· {messageStatus(message.status)}</span>
        )}
      </span>
      {failed && message.sender === 'seller' && (
        <SendFailure conversationId={conversationId} message={message} />
      )}
    </div>
  );
}

/**
 * Why a reply didn't go out, with Retry and Remove. Retry replaces the failed
 * copy rather than leaving it behind.
 */
function SendFailure({ conversationId, message }: { conversationId: string; message: ThreadItem }) {
  const { t } = useTranslation('conversations');
  const { forError, forCode } = useErrorMessages();
  const actions = useFailedMessageActions(conversationId);
  const { local } = message;
  const reason = local
    ? forError(local.error)
    : actions.deleteError
      ? forError(actions.deleteError)
      : forCode('MESSENGER_SEND_FAILED');

  return (
    <div className="flex flex-col items-end gap-1">
      <p role={local ? 'alert' : undefined} className="text-right text-small text-danger">
        {reason}
      </p>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={actions.deleting}
          onClick={() =>
            local
              ? actions.retry(local)
              : actions.retryStored({ id: message.key, text: message.text })
          }
        >
          {t('thread.retry')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={actions.deleting}
          onClick={() =>
            local ? actions.remove(local.mutationId) : actions.removeStored(message.key)
          }
        >
          {t('thread.remove')}
        </Button>
      </div>
    </div>
  );
}
