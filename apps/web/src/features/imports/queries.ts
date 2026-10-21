import { useEffect, useRef } from 'react';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  ACTIVE_IMPORT_STATUSES,
  type ActivateImport,
  type ActivateImportResult,
  type CreateImport,
  type FacebookImportAccess,
  type ImportPost,
  type ImportPostListResponse,
  type ImportRun,
  type ImportRunListResponse,
  type ImportRunStatus,
  type ListImportPostsQuery,
  type ListImportsQuery,
  type ProductImportSource,
} from '@app/shared';

import { catalogKeys } from '@/features/catalog/queries';
import { apiFetch } from '@/lib/api';

/** How often a going run's page asks for its progress. */
const RUN_POLL_MS = 3000;

/**
 * Catalog > Imports, under /api/v1/imports. A run's posts and the products it
 * made change while it goes, so a run refetch also refreshes its posts.
 */
export const importKeys = {
  all: ['imports'] as const,
  access: () => [...importKeys.all, 'access'] as const,
  lists: () => [...importKeys.all, 'list'] as const,
  list: (query: ListImportsQuery) => [...importKeys.lists(), query] as const,
  run: (id: string) => [...importKeys.all, 'run', id] as const,
  posts: (id: string) => [...importKeys.run(id), 'posts'] as const,
  postList: (id: string, query: ListImportPostsQuery) => [...importKeys.posts(id), query] as const,
  productSource: (productId: string) => [...importKeys.all, 'product', productId] as const,
};

export const isGoing = (status: ImportRunStatus) =>
  (ACTIVE_IMPORT_STATUSES as readonly ImportRunStatus[]).includes(status);

const runPath = (id: string) => `/imports/${encodeURIComponent(id)}`;

/** A run's progress, or the products it made, moved: its page, the history and the products list. */
const refreshRun = (queryClient: QueryClient, id: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: importKeys.run(id) }),
    queryClient.invalidateQueries({ queryKey: importKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.productLists() }),
  ]);

/** Asked each time the dialog opens: a Page can lose the permission at any time. */
export function useFacebookImportAccess(enabled: boolean) {
  return useQuery({
    queryKey: importKeys.access(),
    queryFn: () => apiFetch<FacebookImportAccess>('/imports/facebook/access'),
    enabled,
    staleTime: 0,
    retry: false,
  });
}

/** While any run on the page is going, the history follows it. */
export function useImportRuns(query: ListImportsQuery) {
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  return useQuery({
    queryKey: importKeys.list(query),
    queryFn: () => apiFetch<ImportRunListResponse>(`/imports?${params.toString()}`),
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      q.state.data?.data.some((run) => isGoing(run.status)) ? RUN_POLL_MS : false,
  });
}

export const importRunQueryOptions = (id: string) =>
  queryOptions({
    queryKey: importKeys.run(id),
    queryFn: () => apiFetch<ImportRun>(runPath(id)),
  });

/** Polls while the run is queued, running or stopping, and stops at any other status. */
export function useImportRun(id: string) {
  return useQuery({
    ...importRunQueryOptions(id),
    refetchInterval: (q) => (q.state.data && isGoing(q.state.data.status) ? RUN_POLL_MS : false),
  });
}

/**
 * A page of a run's posts. Polls at `refetchInterval`, and also while a post
 * on the page is being read again by Import anyway.
 */
export function useImportPosts(id: string, query: ListImportPostsQuery, refetchInterval = 0) {
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  if (query.result) params.set('result', query.result);
  return useQuery({
    queryKey: importKeys.postList(id, query),
    queryFn: () => apiFetch<ImportPostListResponse>(`${runPath(id)}/posts?${params.toString()}`),
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      refetchInterval ||
      (q.state.data?.data.some((post) => post.importAnyway === 'queued') ? RUN_POLL_MS : false),
  });
}

/**
 * Once a post Import anyway was reading settles, its drafts or its match
 * change the run's counts, its other tabs and the products list.
 */
export function useRefreshWhenReadAgain(runId: string, posts: readonly ImportPost[]) {
  const queryClient = useQueryClient();
  const reading = useRef(new Set<string>());

  useEffect(() => {
    const now = new Set(
      posts.filter((post) => post.importAnyway === 'queued').map((post) => post.id),
    );
    const settled = [...reading.current].some((id) => !now.has(id));
    reading.current = now;
    if (settled) void refreshRun(queryClient, runId);
  }, [posts, queryClient, runId]);
}

/** The post a product came from, for its edit page. */
export function useProductImportSource(productId: string) {
  return useQuery({
    queryKey: importKeys.productSource(productId),
    queryFn: () =>
      apiFetch<ProductImportSource>(`/imports/products/${encodeURIComponent(productId)}`),
  });
}

export function useStartImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateImport) =>
      apiFetch<ImportRun>('/imports', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (run) => {
      queryClient.setQueryData(importKeys.run(run.id), run);
      void queryClient.invalidateQueries({ queryKey: importKeys.lists() });
    },
  });
}

export function useStopImport(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch<ImportRun>(`${runPath(id)}/stop`, { method: 'POST' }),
    onSuccess: (run) => {
      queryClient.setQueryData(importKeys.run(id), run);
      void queryClient.invalidateQueries({ queryKey: importKeys.lists() });
    },
  });
}

export function useResumeImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiFetch<ImportRun>(`${runPath(id)}/resume`, { method: 'POST' }),
    onSuccess: (run) => {
      queryClient.setQueryData(importKeys.run(run.id), run);
      void queryClient.invalidateQueries({ queryKey: importKeys.lists() });
    },
  });
}

/** The post is read again in the background; its row changes once that is done. */
export function useImportAnyway(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch<ImportPost>(`${runPath(id)}/posts/${encodeURIComponent(postId)}/import`, {
        method: 'POST',
      }),
    onSuccess: () => refreshRun(queryClient, id),
  });
}

export function useActivateImport(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ActivateImport) =>
      apiFetch<ActivateImportResult>(`${runPath(id)}/activate`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      Promise.all([
        refreshRun(queryClient, id),
        queryClient.invalidateQueries({ queryKey: catalogKeys.products() }),
      ]),
  });
}
