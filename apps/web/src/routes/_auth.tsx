import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ThemeSelect } from '@/components/ThemeSelect';
import { sessionQueryOptions } from '@/features/auth';

/** Sign-in and sign-up. A seller who is already signed in has no business here. */
export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context }) => {
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
