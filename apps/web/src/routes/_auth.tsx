import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ThemeSelect } from '@/components/ThemeSelect';
import { sessionQueryOptions } from '@/features/auth';

/**
 * Sign-in, sign-up and password reset. A seller who is already signed in is
 * sent to the dashboard - except from an emailed reset link, which has to work
 * on a device that is still signed in: resetting is how a seller takes back an
 * account, and the reset ends every session anyway.
 */
export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context, location }) => {
    if (location.pathname === '/reset-password') {
      return;
    }
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (session) {
      throw redirect({ to: '/' });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col bg-bg px-4 py-6 text-ink sm:p-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-accent-soft text-accent">
            <MessageSquareText aria-hidden className="size-5" strokeWidth={1.5} />
          </span>
          <span className="font-semibold">{t('app.name')}</span>
        </div>
        <ThemeSelect />
      </header>
      <main className="flex grow items-center justify-center py-8">
        <Outlet />
      </main>
    </div>
  );
}
