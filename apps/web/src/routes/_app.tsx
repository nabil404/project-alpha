import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ThemeSelect } from '@/components/ThemeSelect';
import { sessionQueryOptions, SignOutButton } from '@/features/auth';

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
  component: AppLayout,
});

function AppLayout() {
  const { t } = useTranslation();
  const navLink = {
    className: 'rounded-md px-3 py-1.5 text-label transition-colors',
    activeProps: { className: 'bg-accent-soft text-accent' },
    inactiveProps: { className: 'text-ink-muted hover:bg-surface-hover hover:text-ink' },
  };

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 sm:px-8">
        <nav className="flex gap-1">
          <Link to="/" {...navLink} activeOptions={{ exact: true }}>
            {t('nav.orders')}
          </Link>
          <Link to="/catalog" {...navLink}>
            {t('nav.catalog')}
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <ThemeSelect />
          <SignOutButton />
        </div>
      </header>
      <main className="px-4 py-6 sm:px-8 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
