import { Fragment, useLayoutEffect, useRef } from 'react';
import { Bot, MapPin, Share2 } from 'lucide-react';
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
  /** Set on a stored message: its kind, attachments, edit and unsend. */
  stored?: Message;
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
  const items: ThreadItem[] = messages.map((message) => ({
    key: message.id,
    ...message,
    stored: message,
  }));

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
  const { isSameDay } = useFormatters();
  const messagesQuery = useMessages(conversationId);
  const local = useLocalMessages(conversationId);
  const stored =
    messagesQuery.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.data) ?? [];
  const { attached, unattached } = placeReactions(stored);
  const messages = threadItems(
    stored.filter((message) => message.kind !== 'reaction' || unattached.has(message.id)),
    local,
  );

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
              {!sameDay(isSameDay, messages[index - 1]?.sentAt, message.sentAt) && (
                <DaySeparator at={message.sentAt} />
              )}
              {message.stored?.kind === 'reaction' ? (
                <ReactionLine reaction={message.stored} />
              ) : (
                <MessageBubble
                  conversationId={conversationId}
                  message={message}
                  reaction={attached.get(message.key)}
                />
              )}
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Where each reaction shows, as Messenger does it: the newest standing one on
 * a loaded message is pinned to that bubble, and a taken-back one disappears.
 * One whose message is not loaded (or was never stored) stays a line in the
 * thread, so the seller still sees it.
 */
function placeReactions(messages: Message[]): {
  attached: Map<string, Message>;
  unattached: Set<string>;
} {
  const loaded = new Set(messages.map((message) => message.id));
  const attached = new Map<string, Message>();
  const unattached = new Set<string>();
  for (const message of messages) {
    if (message.kind !== 'reaction' || message.deleted) continue;
    const target = message.reaction?.messageId;
    if (target && loaded.has(target)) attached.set(target, message);
    else unattached.add(message.id);
  }
  return { attached, unattached };
}

/** Days are the shop's, so a separator falls at the shop's midnight. */
function sameDay(
  isSameDay: (a: string, b: string) => boolean,
  a: string | undefined,
  b: string,
): boolean {
  return a !== undefined && isSameDay(a, b);
}

function DaySeparator({ at }: { at: string }) {
  const { t } = useTranslation('conversations');
  const { formatDate, isSameDay } = useFormatters();
  const today = isSameDay(at);

  return (
    <div className="self-center text-small text-ink-muted">
      {today ? t('thread.today') : formatDate(at)}
    </div>
  );
}

function MessageBubble({
  conversationId,
  message,
  reaction,
}: {
  conversationId: string;
  message: ThreadItem;
  /** The customer's reaction to this message, pinned to its corner. */
  reaction?: Message;
}) {
  const { t } = useTranslation('conversations');
  const { formatDate } = useFormatters();
  const { messageSender, messageStatus, messageContent } = useStatusLabels();
  const inbound = message.sender === 'customer';
  const time = formatDate(message.sentAt, 'time');
  const failed = message.status === 'failed';
  const stored = message.stored;
  const edited = stored?.editedText ?? null;
  const media =
    stored && stored.kind !== 'text' && stored.kind !== 'location' && stored.kind !== 'share';

  return (
    <div
      className={cn(
        'flex max-w-[82%] flex-col gap-1 animate-in fade-in-0 duration-200 lg:max-w-[70%]',
        inbound ? 'items-start self-start' : 'items-end self-end',
      )}
    >
      <div className={cn('relative', reaction && 'mb-3')}>
        {media ? (
          <Attachments message={stored} />
        ) : (
          <div
            className={cn(
              'rounded-lg px-3.5 py-2.5 text-body break-words whitespace-pre-wrap',
              inbound
                ? 'rounded-bl-sm border border-border bg-surface'
                : 'rounded-br-sm bg-accent-soft',
              failed && 'border border-danger',
              message.status === 'sending' && 'opacity-70',
              stored?.deleted && 'text-ink-muted line-through',
            )}
          >
            {stored?.location ? (
              <LocationPin text={messageContent(stored)} {...stored.location} />
            ) : stored?.kind === 'share' ? (
              <SharedPost text={messageContent(stored)} links={stored.links} />
            ) : (
              (edited ?? message.text)
            )}
          </div>
        )}
        {reaction && <ReactionBadge reaction={reaction} inbound={inbound} />}
      </div>
      {edited !== null && (
        <p className="text-small break-words whitespace-pre-wrap text-ink-muted">
          {t('thread.original', { text: message.text })}
        </p>
      )}
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
        {edited !== null && <span>· {t('thread.edited')}</span>}
        {stored?.deleted && <span>· {t('thread.unsent')}</span>}
      </span>
      {failed && message.sender === 'seller' && (
        <SendFailure conversationId={conversationId} message={message} />
      )}
    </div>
  );
}

/**
 * A sticker, photo, video, audio clip or file. Meta's links expire, so each
 * falls back to naming what was sent, and a sticker shows without a bubble.
 */
function Attachments({ message }: { message: Message }) {
  const { t } = useTranslation('conversations');
  const { messageKind, messageContent } = useStatusLabels();
  const kind = messageKind(message.kind).toLowerCase();
  const label = messageContent(message);
  const linked = message.attachments.filter((attachment) => attachment.url !== null);
  if (linked.length === 0) {
    return (
      <span className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-body text-ink-muted">
        {label}
      </span>
    );
  }

  return (
    <div className={cn('flex flex-wrap gap-2', message.deleted && 'opacity-50')}>
      {linked.map(({ url }, index) => {
        const src = url ?? undefined;
        switch (message.kind) {
          case 'sticker':
            return <img key={index} src={src} alt={label} className="size-24 object-contain" />;
          case 'image':
            return (
              <a key={index} href={src} target="_blank" rel="noreferrer noopener">
                <img
                  src={src}
                  alt={label}
                  className="max-h-60 max-w-full rounded-lg border border-border object-cover"
                />
              </a>
            );
          case 'video':
            return (
              <video key={index} src={src} controls className="max-h-60 max-w-full rounded-lg" />
            );
          case 'audio':
            return <audio key={index} src={src} controls className="max-w-full" />;
          default:
            return (
              <a
                key={index}
                href={src}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-body text-accent underline"
              >
                {t('thread.openAttachment', { kind })}
              </a>
            );
        }
      })}
    </div>
  );
}

/** A shared post or ad: the label, then each post by its title, linked when Facebook gave a link. */
function SharedPost({ text, links }: { text: string; links: Message['links'] }) {
  const { t } = useTranslation('conversations');

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <Share2 aria-hidden className="size-4" strokeWidth={1.5} />
        {text}
      </span>
      {links.map(({ url, title }, index) => {
        const name = title ?? t('thread.openPost');
        return url ? (
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-small break-all text-accent underline"
          >
            {name}
          </a>
        ) : (
          title && (
            <span key={index} className="text-small text-ink-muted">
              {title}
            </span>
          )
        );
      })}
    </span>
  );
}

/** A shared pin: the label, the coordinates, and a link to a map. */
function LocationPin({ text, lat, long }: { text: string; lat: number; long: number }) {
  const { t } = useTranslation('conversations');
  const map = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${long}#map=17/${lat}/${long}`;

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <MapPin aria-hidden className="size-4" strokeWidth={1.5} />
        {text}
      </span>
      <span className="text-small text-ink-muted tabular-nums">
        {lat.toFixed(5)}, {long.toFixed(5)}
      </span>
      <a
        href={map}
        target="_blank"
        rel="noreferrer noopener"
        className="text-small text-accent underline"
      >
        {t('thread.openMap')}
      </a>
    </span>
  );
}

/** A reaction pinned to the bottom corner of the message it answers, as in Messenger. */
function ReactionBadge({ reaction, inbound }: { reaction: Message; inbound: boolean }) {
  const { t } = useTranslation('conversations');
  const { formatDate } = useFormatters();
  const emoji = reaction.reaction?.emoji ?? '';
  const label = t('thread.reactionBadge', {
    emoji,
    time: formatDate(reaction.sentAt, 'time'),
  });

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'absolute -bottom-3 flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-surface px-1 text-small leading-none shadow-sm animate-in zoom-in-50 duration-200',
        inbound ? 'right-1.5' : 'left-1.5',
      )}
    >
      {emoji}
    </span>
  );
}

/** A reaction whose message is not in the thread: a line, so it is not lost. */
function ReactionLine({ reaction }: { reaction: Message }) {
  const { formatDate } = useFormatters();
  const { messageContent } = useStatusLabels();

  return (
    <p className="self-start text-small text-ink-muted">
      {messageContent(reaction)} ·{' '}
      <time dateTime={reaction.sentAt}>{formatDate(reaction.sentAt, 'time')}</time>
    </p>
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
