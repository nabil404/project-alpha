import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConnectFacebookPageInput,
  FacebookAuthorization,
  FacebookPage,
  FacebookPageCandidatesResponse,
  FacebookPageResponse,
} from '@app/shared';

import { apiFetch } from '@/lib/api';

/**
 * The shop's Facebook Page, under /api/v1/messenger/page. Connecting is a
 * round trip through Facebook: useStartPageConnect leaves for Facebook's
 * dialog, the API's callback sends the browser back to
 * /settings/messenger?step=choose-page, and the candidates query plus
 * useConnectPage finish it there. The flow's state rides in an httpOnly
 * cookie the SPA never sees.
 */
export const messengerKeys = {
  all: ['messenger'] as const,
  page: () => [...messengerKeys.all, 'page'] as const,
  candidates: () => [...messengerKeys.all, 'candidates'] as const,
};

export const facebookPageQueryOptions = () =>
  queryOptions({
    queryKey: messengerKeys.page(),
    queryFn: () => apiFetch<FacebookPageResponse>('/messenger/page'),
  });

export function useFacebookPage() {
  return useQuery(facebookPageQueryOptions());
}

/** Only while choosing: the list comes from Facebook, read with the flow cookie. */
export function usePageCandidates(enabled: boolean) {
  return useQuery({
    queryKey: messengerKeys.candidates(),
    queryFn: () => apiFetch<FacebookPageCandidatesResponse>('/messenger/page/candidates'),
    enabled,
    // The flow cookie expires in minutes, and an expiry is an answer, not a blip.
    retry: false,
    staleTime: 0,
  });
}

/** Sends the browser to Facebook's Login dialog; it comes back to this page. */
export function useStartPageConnect() {
  return useMutation({
    mutationFn: () =>
      apiFetch<FacebookAuthorization>('/messenger/page/authorizations', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useConnectPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ConnectFacebookPageInput) =>
      apiFetch<FacebookPage>('/messenger/page', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messengerKeys.all }),
  });
}

export function useDisconnectPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch<void>('/messenger/page', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messengerKeys.all }),
  });
}
