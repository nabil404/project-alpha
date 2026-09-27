import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ThemeSelect } from '@/components/ThemeSelect';

function RootLayout() {
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
        <ThemeSelect />
      </header>
      <main className="px-4 py-6 sm:px-8 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function OrdersPage() {
  const { t } = useTranslation('orders');

  return <h1 className="text-display">{t('list.title')}</h1>;
}

function CatalogPage() {
  const { t } = useTranslation('catalog');

  return <h1 className="text-display">{t('list.title')}</h1>;
}

const rootRoute = createRootRoute({ component: RootLayout });

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OrdersPage,
});

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  component: CatalogPage,
});

const routeTree = rootRoute.addChildren([ordersRoute, catalogRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
