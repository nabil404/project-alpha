import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-dvh bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <nav className="flex gap-4 text-sm font-medium">
          <Link to="/" className="hover:underline">
            Orders
          </Link>
          <Link to="/catalog" className="hover:underline">
            Catalog
          </Link>
        </nav>
      </header>
      <main className="px-6 py-8">
        <Outlet />
      </main>
    </div>
  ),
});

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <h1 className="text-xl font-semibold">Orders</h1>,
});

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  component: () => <h1 className="text-xl font-semibold">Catalog</h1>,
});

const routeTree = rootRoute.addChildren([ordersRoute, catalogRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
