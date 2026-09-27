import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SignInInput, SignUpInput } from '@app/shared';

import { apiFetch } from '@/lib/api';

/**
 * Better Auth's endpoints, under /api/v1/auth. They answer errors in the same
 * coded envelope as every other route, so they go through apiFetch rather
 * than Better Auth's own client.
 */

export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
};

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  phone: string | null;
}

export interface Session {
  session: { id: string; expiresAt: string; activeOrganizationId: string | null };
  user: SessionUser;
}

/** Where the emailed verification link sends the seller once it has signed them in. */
const VERIFIED_CALLBACK_URL = '/';

/** The signed-in seller, or null. Better Auth answers 200 with `null` when there is no session. */
export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: authKeys.session(),
    queryFn: () => apiFetch<Session | null>('/auth/get-session'),
  });

export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SignInInput) =>
      apiFetch<unknown>('/auth/sign-in/email', {
        method: 'POST',
        // An unverified seller is sent a fresh link here, and it needs somewhere to land.
        body: JSON.stringify({ ...input, callbackURL: VERIFIED_CALLBACK_URL }),
      }),
    // Nothing cached before sign-in may outlive it: it could belong to another seller.
    onSuccess: () => queryClient.clear(),
  });
}

export function useSignUp() {
  return useMutation({
    mutationFn: (input: SignUpInput) =>
      apiFetch<unknown>('/auth/sign-up/email', {
        method: 'POST',
        body: JSON.stringify({ ...input, callbackURL: VERIFIED_CALLBACK_URL }),
      }),
  });
}

export function useResendVerificationEmail() {
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<unknown>('/auth/send-verification-email', {
        method: 'POST',
        body: JSON.stringify({ email, callbackURL: VERIFIED_CALLBACK_URL }),
      }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch<unknown>('/auth/sign-out', { method: 'POST', body: '{}' }),
    // The next seller on this browser must not see this one's cached data.
    onSuccess: () => queryClient.clear(),
  });
}

export type SocialProvider = 'google' | 'facebook';

/**
 * Starts a Google or Facebook sign-in. Better Auth answers with the provider's
 * consent URL; the browser leaves for it, and comes back to `callbackURL`, or
 * to the sign-in page with `?error=` if the provider refused.
 */
export function useSocialSignIn() {
  return useMutation({
    mutationFn: ({ provider, callbackURL }: { provider: SocialProvider; callbackURL: string }) =>
      apiFetch<{ url: string }>('/auth/sign-in/social', {
        method: 'POST',
        body: JSON.stringify({ provider, callbackURL, errorCallbackURL: '/sign-in' }),
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}
