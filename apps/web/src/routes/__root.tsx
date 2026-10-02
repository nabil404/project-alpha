import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { Toaster } from '@/components/ui/sonner';

export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * Bare on purpose: the signed-in shell lives in _app.tsx, the sign-in pages' in
 * _auth.tsx. The toaster sits here so toasts outlive a move between the two.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}
