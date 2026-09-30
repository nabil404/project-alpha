import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AccountAvatar,
  ChangePasswordInput,
  DeviceSession,
  UpdateProfileInput,
} from '@app/shared';

import { authKeys } from '@/features/auth';
import { apiFetch } from '@/lib/api';

/**
 * Settings > Account. Name and password go to Better Auth under /auth; the
 * photo and devices to our own /account routes, which keep session tokens on
 * the server.
 */
export const accountKeys = {
  all: ['account'] as const,
  sessions: () => [...accountKeys.all, 'sessions'] as const,
};

export const deviceSessionsQueryOptions = () =>
  queryOptions({
    queryKey: accountKeys.sessions(),
    queryFn: () => apiFetch<DeviceSession[]>('/account/sessions'),
  });

/** The name lives on the session's user, so the sidebar re-reads it. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      apiFetch<{ status: boolean }>('/auth/update-user', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session() }),
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return apiFetch<AccountAvatar>('/account/avatar', { method: 'PUT', body });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session() }),
  });
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch<AccountAvatar>('/account/avatar', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session() }),
  });
}

/**
 * With `revokeOtherSessions`, Better Auth ends every other session and gives
 * this browser a fresh one, so the device list and the password's
 * "last changed" both move.
 */
export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiFetch<unknown>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: authKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: authKeys.session() }),
        queryClient.invalidateQueries({ queryKey: accountKeys.sessions() }),
      ]),
  });
}

/** Refetches the list either way: a 404 means the device was already signed out. */
export function useRevokeDeviceSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch<void>(`/account/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions() }),
  });
}
