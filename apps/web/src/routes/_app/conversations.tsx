import { useCallback } from 'react';
import { createFileRoute, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { listConversationsQuerySchema, type ConversationFilter } from '@app/shared';

import { ConversationList } from '@/features/conversations';
import { cn } from '@/lib/utils';

interface ConversationsSearch {
  /** Absent means `all`, so the plain page keeps a plain URL. */
  filter?: Exclude<ConversationFilter, 'all'>;
  q?: string;
}

const searchSchema = listConversationsQuerySchema.pick({ filter: true, q: true });

/**
 * The list beside the open chat from `lg` up. Below it, one pane at a time:
 * the list at /conversations, the chat at /conversations/:id. The filter and
 * search live in the URL, so they survive opening a chat and going back.
 */
export const Route = createFileRoute('/_app/conversations')({
  staticData: { fullBleed: true },
  validateSearch: (search: Record<string, unknown>): ConversationsSearch => {
    // A hand-typed `?q=481` arrives as a number: the router parses search values as JSON.
    const parsed = searchSchema.safeParse({
      ...search,
      q: typeof search.q === 'number' ? String(search.q) : search.q,
    });
    if (!parsed.success) return {};
    const { filter, q } = parsed.data;
    return { filter: filter === 'all' ? undefined : filter, q };
  },
  component: ConversationsLayout,
});

function ConversationsLayout() {
  const { filter = 'all', q } = Route.useSearch();
  const { conversationId } = useParams({ strict: false });
  const navigate = useNavigate();

  const onFilterChange = useCallback(
    (next: ConversationFilter) =>
      void navigate({
        to: '.',
        search: (prev) => ({ ...prev, filter: next === 'all' ? undefined : next }),
        replace: true,
      }),
    [navigate],
  );

  const onSearchChange = useCallback(
    (next: string | undefined) =>
      void navigate({ to: '.', search: (prev) => ({ ...prev, q: next }), replace: true }),
    [navigate],
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] lg:h-dvh">
      <div
        className={cn(
          'flex w-full flex-col bg-surface lg:w-90 lg:shrink-0 lg:border-r lg:border-border',
          conversationId && 'max-lg:hidden',
        )}
      >
        <ConversationList
          filter={filter}
          q={q}
          selectedId={conversationId}
          onFilterChange={onFilterChange}
          onSearchChange={onSearchChange}
        />
      </div>
      <div className={cn('flex min-w-0 grow bg-bg', !conversationId && 'max-lg:hidden')}>
        <Outlet />
      </div>
    </div>
  );
}
