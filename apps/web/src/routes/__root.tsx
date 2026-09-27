import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

export interface RouterContext {
  queryClient: QueryClient;
}

/** Bare on purpose: the signed-in shell lives in _app.tsx, the sign-in pages' in _auth.tsx. */
export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});
