import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  conversationFilters,
  type ConversationCounts,
  type ConversationFilter,
  type ConversationListItem,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { conversationStateTones } from '@/i18n/status-tones';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useConversationCounts, useConversationList } from '../queries';
import { ConversationStateBadge } from './ConversationStateBadge';
import { CustomerAvatar } from './CustomerAvatar';
import { useCustomerName } from './customer-name';

const SEARCH_DEBOUNCE_MS = 300;

const countKeys = {
  all: 'all',
  needs_you: 'needsYou',
  drafted: 'drafted',
  unread: 'unread',
} as const satisfies Record<ConversationFilter, keyof ConversationCounts>;

/** Search, the filter chips and the conversations they select, newest activity first. */
export function ConversationList({
  filter,
  q,
  selectedId,
  onFilterChange,
  onSearchChange,
}: {
  filter: ConversationFilter;
  q: string | undefined;
  selectedId: string | undefined;
  onFilterChange: (filter: ConversationFilter) => void;
  onSearchChange: (q: string | undefined) => void;
}) {
  const { t } = useTranslation(['conversations', 'common']);
  const { forError } = useErrorMessages();
  const counts = useConversationCounts();
  const list = useConversationList(filter, q);
  const conversations = list.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section aria-label={t('list.label')} className="flex min-h-0 grow flex-col">
      <div className="flex flex-col gap-4 border-b border-border px-4 pt-4 pb-3 lg:border-0 lg:px-6 lg:pt-6">
        <h1 className="hidden text-display lg:block">{t('list.title')}</h1>
        <SearchInput value={q} onChange={onSearchChange} />
        <div
          role="group"
          aria-label={t('filters.label')}
          className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0"
        >
          {conversationFilters.map((option) => {
            const pressed = option === filter;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={pressed}
                onClick={() => onFilterChange(option)}
                className={cn(
                  'flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-label transition-colors duration-[120ms] lg:h-8',
                  pressed
                    ? 'border-accent-soft bg-accent-soft text-accent'
                    : 'border-border bg-surface text-ink hover:bg-surface-hover',
                )}
              >
                {t(`filters.${option}`)}
                {counts.data && (
                  <span className="text-ink-muted tabular-nums">
                    {counts.data[countKeys[option]]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 grow overflow-y-auto lg:px-3 lg:pb-3">
        {list.isError ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <ErrorBanner className="w-full">{forError(list.error)}</ErrorBanner>
            <Button size="sm" onClick={() => void list.refetch()}>
              {t('common:actions.retry')}
            </Button>
          </div>
        ) : list.isPending ? (
          <ListSkeleton />
        ) : conversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-body text-ink-muted lg:px-3">
            {q || filter !== 'all' ? t('list.emptyFiltered') : t('list.empty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border lg:gap-0.5 lg:divide-y-0">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="animate-in fade-in-0 duration-200">
                <ConversationRow
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                />
              </li>
            ))}
          </ul>
        )}

        {list.hasNextPage && (
          <div className="flex justify-center p-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('list.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Typing updates the box at once and the URL (and so the query) once the seller pauses. */
function SearchInput({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (q: string | undefined) => void;
}) {
  const { t } = useTranslation('conversations');
  const [draft, setDraft] = useState(value ?? '');

  // Back/forward changes the URL under the box.
  useEffect(() => setDraft(value ?? ''), [value]);

  useEffect(() => {
    const next = draft.trim() || undefined;
    if (next === value) return;
    const timer = setTimeout(() => onChange(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <div className="relative flex items-center">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 size-4 text-ink-muted"
        strokeWidth={1.5}
      />
      <Input
        type="search"
        aria-label={t('list.searchLabel')}
        placeholder={t('list.searchPlaceholder')}
        maxLength={100}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="pl-9"
      />
    </div>
  );
}

function ConversationRow({
  conversation,
  selected,
}: {
  conversation: ConversationListItem;
  selected: boolean;
}) {
  const { t } = useTranslation('conversations');
  const { messageSender } = useStatusLabels();
  const customerName = useCustomerName();
  const { lastMessage } = conversation;
  const preview =
    lastMessage.sender === 'customer'
      ? lastMessage.preview
      : t('list.preview', { sender: messageSender(lastMessage.sender), text: lastMessage.preview });

  return (
    <Link
      to="/conversations/$conversationId"
      params={{ conversationId: conversation.id }}
      search={(prev) => prev}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex items-start gap-3 px-4 py-3 text-ink transition-colors duration-[120ms] lg:rounded-md lg:px-3',
        selected ? 'bg-accent-soft' : 'bg-surface hover:bg-surface-hover',
      )}
    >
      <CustomerAvatar
        name={conversation.customer.name}
        pictureUrl={conversation.customer.pictureUrl}
        className="size-11 lg:size-10"
      />
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 grow truncate text-body',
              conversation.unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {customerName(conversation.customer.name)}
          </span>
          <ListTime at={lastMessage.at} />
          {conversation.unread && (
            <span className="size-2 shrink-0 rounded-full bg-accent">
              <span className="sr-only">{t('list.unread')}</span>
            </span>
          )}
        </span>
        <span className="truncate text-small text-ink-muted">{preview}</span>
        {conversationStateTones[conversation.state] && (
          <span className="mt-1 flex">
            <ConversationStateBadge state={conversation.state} />
          </span>
        )}
      </span>
    </Link>
  );
}

/** The time for today's activity, the day for anything older. */
function ListTime({ at }: { at: string }) {
  const { formatDate, isSameDay } = useFormatters();

  return (
    <time dateTime={at} className="shrink-0 text-small text-ink-muted">
      {formatDate(at, isSameDay(at) ? 'time' : 'dayMonth')}
    </time>
  );
}

function ListSkeleton() {
  return (
    <ul aria-hidden className="flex flex-col">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex gap-3 px-4 py-3 lg:px-3">
          <span className="size-10 shrink-0 animate-pulse rounded-full bg-surface-sunken" />
          <span className="flex grow flex-col gap-2 pt-1">
            <span className="h-4 w-1/2 animate-pulse rounded-sm bg-surface-sunken" />
            <span className="h-3 w-3/4 animate-pulse rounded-sm bg-surface-sunken" />
          </span>
        </li>
      ))}
    </ul>
  );
}
