import { useEffect } from 'react';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  CONVERSATION_STREAM_EVICTED_EVENT,
  CONVERSATION_UPDATED_EVENT,
  conversationUpdatedEventSchema,
  type ConversationCounts,
  type ConversationDetail,
  type ConversationFilter,
  type ConversationListResponse,
  type Message,
  type MessagePage,
  type SendMessage,
  type UpdateConversation,
} from '@app/shared';

import { apiFetch } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * The shop's Messenger conversations, under /api/v1/conversations. Nothing
 * here polls: useConversationEvents listens on the API's event stream and
 * invalidates whatever a change touches.
 */
export const conversationKeys = {
  all: ['conversations'] as const,
  lists: () => [...conversationKeys.all, 'list'] as const,
  list: (filter: ConversationFilter, q: string | undefined) =>
    [...conversationKeys.lists(), { filter, q }] as const,
  counts: () => [...conversationKeys.all, 'counts'] as const,
  detail: (id: string) => [...conversationKeys.all, 'detail', id] as const,
  messages: (id: string) => [...conversationKeys.all, 'messages', id] as const,
  sends: (id: string) => [...conversationKeys.all, 'send', id] as const,
};

export const conversationListQueryOptions = (filter: ConversationFilter, q: string | undefined) =>
  infiniteQueryOptions({
    queryKey: conversationKeys.list(filter, q),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ filter });
      if (q) params.set('q', q);
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<ConversationListResponse>(`/conversations?${params}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor ?? undefined,
  });

export function useConversationList(filter: ConversationFilter, q: string | undefined) {
  return useInfiniteQuery(conversationListQueryOptions(filter, q));
}

export const conversationCountsQueryOptions = () =>
  queryOptions({
    queryKey: conversationKeys.counts(),
    queryFn: () => apiFetch<ConversationCounts>('/conversations/counts'),
  });

export function useConversationCounts() {
  return useQuery(conversationCountsQueryOptions());
}

export const conversationQueryOptions = (id: string) =>
  queryOptions({
    queryKey: conversationKeys.detail(id),
    queryFn: () => apiFetch<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`),
  });

export function useConversation(id: string) {
  return useQuery(conversationQueryOptions(id));
}

/**
 * Pages run newest first — the first page is the latest messages and each
 * next page is older — so a refetch after an event starts from the newest
 * page. Callers reverse the pages to read the thread oldest first.
 */
export const messagesQueryOptions = (id: string) =>
  infiniteQueryOptions({
    queryKey: conversationKeys.messages(id),
    queryFn: ({ pageParam }) => {
      const query = pageParam ? `?${new URLSearchParams({ before: pageParam })}` : '';
      return apiFetch<MessagePage>(`/conversations/${encodeURIComponent(id)}/messages${query}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.prevCursor ?? undefined,
  });

export function useMessages(id: string) {
  return useInfiniteQuery(messagesQueryOptions(id));
}

export function useMarkRead(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/conversations/${encodeURIComponent(id)}/read`, { method: 'PUT' }),
    onSuccess: () => {
      queryClient.setQueryData<ConversationDetail>(conversationKeys.detail(id), (current) =>
        current ? { ...current, unread: false } : current,
      );
      void queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.counts() });
    },
  });
}

/** Take over (`botPaused: true`) or hand back (`false`). */
export function useUpdateConversation(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateConversation) =>
      apiFetch<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (conversation) => {
      queryClient.setQueryData(conversationKeys.detail(id), conversation);
      void queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.counts() });
    },
  });
}

/**
 * A reply the API stored before Messenger turned it down: the thread already
 * holds it as a `failed` message, so the local copy must not show as well.
 */
function isRecordedFailure(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'MESSENGER_SEND_FAILED';
}

/** Adds a delivered reply to the newest page (pages run newest first, each oldest first). */
function appendMessage(
  data: InfiniteData<MessagePage, string | undefined> | undefined,
  message: Message,
): InfiniteData<MessagePage, string | undefined> | undefined {
  const [newest, ...older] = data?.pages ?? [];
  if (!data || !newest || newest.data.some(({ id }) => id === message.id)) {
    return data;
  }
  return { ...data, pages: [{ ...newest, data: [...newest.data, message] }, ...older] };
}

/**
 * A seller reply. The API pauses the assistant in this chat as it sends.
 *
 * Sends are eager: the composer fires and clears at once, and the reply shows
 * in the thread from useLocalMessages until the API answers. One chat's
 * replies share a scope, so they go out one at a time, in the order written.
 * `gcTime: Infinity` keeps a failed reply on screen until the seller retries
 * or removes it; useLocalMessages prunes the delivered ones.
 */
export function useSendMessage(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: conversationKeys.sends(id),
    scope: { id: `conversation-send:${id}` },
    gcTime: Infinity,
    mutationFn: (input: SendMessage) =>
      apiFetch<Message>(`/conversations/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    // In the same tick the local copy leaves, so the reply never blinks out.
    onSuccess: (message) => {
      queryClient.setQueryData(
        conversationKeys.messages(id),
        (data: InfiniteData<MessagePage, string | undefined> | undefined) =>
          appendMessage(data, message),
      );
      void queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    },
    // A recorded failure waits for the thread to hold the stored copy before the local one goes.
    onError: async (error) => {
      const refetch = queryClient.invalidateQueries({ queryKey: conversationKeys.all });
      if (isRecordedFailure(error)) await refetch;
    },
  });
}

/** A reply in flight, or one that failed before the API stored it. */
export interface LocalMessage {
  mutationId: number;
  text: string;
  submittedAt: number;
  status: 'sending' | 'failed';
  error: unknown;
}

/** This chat's replies that exist only in the browser, oldest first. */
export function useLocalMessages(id: string): LocalMessage[] {
  const queryClient = useQueryClient();

  const local = useMutationState({
    filters: {
      mutationKey: conversationKeys.sends(id),
      predicate: ({ state }) =>
        state.status === 'pending' || (state.status === 'error' && !isRecordedFailure(state.error)),
    },
    select: ({ mutationId, state }): LocalMessage => ({
      mutationId,
      text: (state.variables as SendMessage).text,
      submittedAt: state.submittedAt,
      status: state.status === 'error' ? 'failed' : 'sending',
      error: state.error,
    }),
  });

  // Delivered and recorded-failed replies now live in the thread; drop their mutations.
  const settled = local.length;
  useEffect(() => {
    const cache = queryClient.getMutationCache();
    for (const mutation of cache.findAll({
      mutationKey: conversationKeys.sends(id),
      exact: true,
    })) {
      const { status, error } = mutation.state;
      if (status === 'success' || (status === 'error' && isRecordedFailure(error))) {
        cache.remove(mutation);
      }
    }
  }, [queryClient, id, settled]);

  return local;
}

/** Deletes a reply the API stored as failed; nothing else is deletable. */
export function useDeleteMessage(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<void>(
        `/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_, messageId) => {
      queryClient.setQueryData(
        conversationKeys.messages(id),
        (data: InfiniteData<MessagePage, string | undefined> | undefined) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              data: page.data.filter((message) => message.id !== messageId),
            })),
          },
      );
      void queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

/**
 * What a failed reply offers. Retry sends it again, at the back of the queue,
 * and forgets the failed copy; remove only forgets it. A local reply is
 * forgotten in the browser, one the API stored is deleted there.
 */
export function useFailedMessageActions(id: string) {
  const queryClient = useQueryClient();
  const send = useSendMessage(id);
  const deleteStored = useDeleteMessage(id);

  const remove = (mutationId: number) => {
    const cache = queryClient.getMutationCache();
    const mutation = cache.getAll().find((candidate) => candidate.mutationId === mutationId);
    if (mutation) cache.remove(mutation);
  };

  return {
    remove,
    retry: (message: Pick<LocalMessage, 'mutationId' | 'text'>) => {
      remove(message.mutationId);
      send.mutate({ text: message.text });
    },
    retryStored: (message: { id: string; text: string }) => {
      send.mutate({ text: message.text });
      deleteStored.mutate(message.id);
    },
    removeStored: (messageId: string) => deleteStored.mutate(messageId),
    /** A failed delete of a stored reply, which then stays in the thread. */
    deleting: deleteStored.isPending,
    deleteError: deleteStored.error,
  };
}

/**
 * Keeps every conversation query fresh while mounted, from the API's
 * Server-Sent Events. Each event carries only an id, so it invalidates and
 * lets the queries refetch; a reconnect may have missed events, so it
 * invalidates everything. An `evicted` stream is closed for good — reconnecting
 * would evict another of the seller's tabs in turn.
 */
export function useConversationEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/v1/conversations/events');
    let opened = false;

    const onReady = () => {
      if (opened) {
        void queryClient.invalidateQueries({ queryKey: conversationKeys.all });
      }
      opened = true;
    };

    const onUpdated = (event: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = conversationUpdatedEventSchema.safeParse(data);
      if (!parsed.success) return;

      const { conversationId } = parsed.data;
      void queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.counts() });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
    };

    const onEvicted = () => source.close();

    source.addEventListener('ready', onReady);
    source.addEventListener(CONVERSATION_UPDATED_EVENT, onUpdated);
    source.addEventListener(CONVERSATION_STREAM_EVICTED_EVENT, onEvicted);

    return () => source.close();
  }, [queryClient]);
}
