import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

function RootLayout() {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <nav className="flex gap-4 text-sm font-medium">
          <Link to="/" className="hover:underline">
            {t('nav.orders')}
          </Link>
          <Link to="/catalog" className="hover:underline">
            {t('nav.catalog')}
          </Link>
        </nav>
      </header>
      <main className="px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function OrdersPage() {
  const { t } = useTranslation('orders');

  return <h1 className="text-xl font-semibold">{t('list.title')}</h1>;
}

function CatalogPage() {
  const { t } = useTranslation('catalog');

  return <h1 className="text-xl font-semibold">{t('list.title')}</h1>;
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
