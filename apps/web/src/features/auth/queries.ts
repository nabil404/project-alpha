import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ACCOUNT_SETTINGS_PATH,
  type RequestPasswordResetInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
} from '@app/shared';

import { apiFetch } from '@/lib/api';

/**
 * Better Auth's endpoints, under /api/v1/auth. They answer errors in the same
 * coded envelope as every other route, so they go through apiFetch rather
 * than Better Auth's own client.
 */

export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
  accounts: () => [...authKeys.all, 'accounts'] as const,
};

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  phone: string | null;
  /** The dashboard language this person picked; null follows the shop's country. */
  locale: string | null;
}

export interface Session {
  session: { id: string; expiresAt: string; activeOrganizationId: string | null };
  user: SessionUser;
}

/** Where the emailed verification link sends the seller once it has signed them in. */
const VERIFIED_CALLBACK_URL = '/';

/** Where the emailed reset link lands, with `?token=` (or `?error=INVALID_TOKEN`). */
const RESET_PASSWORD_URL = '/reset-password';

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

/** Answers the same for an unknown email, so the form can't be used to probe for accounts. */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: ({ email }: RequestPasswordResetInput) =>
      apiFetch<unknown>('/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email, redirectTo: RESET_PASSWORD_URL }),
      }),
  });
}

export function useResetPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ResetPasswordInput & { token: string }) =>
      apiFetch<unknown>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    // A reset signs the account out everywhere, this browser included, so a
    // cached session would now be a lie.
    onSuccess: () => queryClient.clear(),
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

/** One way the seller can sign in: `credential` is email and password. */
export interface LinkedAccount {
  id: string;
  providerId: SocialProvider | 'credential';
  createdAt: string;
  /** When it last changed; for `credential`, when the password was last set. */
  updatedAt: string;
}

export const linkedAccountsQueryOptions = () =>
  queryOptions({
    queryKey: authKeys.accounts(),
    queryFn: () => apiFetch<LinkedAccount[]>('/auth/list-accounts'),
  });

/**
 * Adds a Google or Facebook sign-in to the signed-in seller's account. Like
 * useSocialSignIn it leaves for the provider, and comes back to Settings >
 * Account, with `?error=<ErrorCode>` if the link was refused.
 */
export function useLinkSocial() {
  return useMutation({
    mutationFn: (provider: SocialProvider) =>
      apiFetch<{ url: string }>('/auth/link-social', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          callbackURL: ACCOUNT_SETTINGS_PATH,
          errorCallbackURL: ACCOUNT_SETTINGS_PATH,
        }),
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

/**
 * Removes a Google or Facebook sign-in from the seller's account, by the
 * account row's `id`. Better Auth refuses the seller's last method, and a
 * session older than a day (`AUTH_SESSION_NOT_FRESH`).
 */
export function useUnlinkAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch<{ status: boolean }>('/auth/unlink-account', {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.accounts() }),
  });
}
