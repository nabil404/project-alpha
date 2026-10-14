import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WelcomeScreen, WelcomeScreenInput } from '@app/shared';

import { apiFetch } from '@/lib/api';

import { messengerKeys } from './queries';

const POLL_MS = 3_000;
const POLL_FOR_MS = 60_000;

export const welcomeScreenQueryOptions = () =>
  queryOptions({
    queryKey: [...messengerKeys.all, 'welcome'] as const,
    queryFn: () => apiFetch<WelcomeScreen>('/settings/messenger-welcome'),
  });

/**
 * When the last save in this tab landed. Polling stops a minute after it: a
 * worker that is down shows "Updating…" until reload instead of polling forever.
 * (`dataUpdatedAt` would move on every poll and never stop it.)
 */
let lastSavedAt = 0;

/** Polls while the Page is being updated, for at most a minute after the last save. */
export function useWelcomeScreen() {
  return useQuery({
    ...welcomeScreenQueryOptions(),
    refetchInterval: (query) =>
      query.state.data?.profileSync.status === 'pending' && Date.now() - lastSavedAt < POLL_FOR_MS
        ? POLL_MS
        : false,
  });
}

export function useSaveWelcomeScreen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WelcomeScreenInput) =>
      apiFetch<WelcomeScreen>('/settings/messenger-welcome', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: (saved) => {
      lastSavedAt = Date.now();
      queryClient.setQueryData(welcomeScreenQueryOptions().queryKey, saved);
    },
  });
}
