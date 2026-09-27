import { createFileRoute, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell/AppShell';
import { sessionQueryOptions } from '@/features/auth';

/**
 * Every dashboard page needs a signed-in seller. Without a session the seller
 * is sent to sign-in and brought back afterwards - except when they arrive from
 * an emailed link that failed (`/?error=INVALID_TOKEN`), where the error goes
 * with them so sign-in can say what happened.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (session) {
      return { session };
    }

    const error = (location.search as Record<string, unknown>).error;
    throw redirect({
      to: '/sign-in',
      search:
        typeof error === 'string'
          ? { error }
          : { redirect: location.href === '/' ? undefined : location.href },
    });
  },
  component: AppShell,
});
