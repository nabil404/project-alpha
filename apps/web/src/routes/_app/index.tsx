import { createFileRoute, redirect } from '@tanstack/react-router';

/** Orders is the dashboard's home until the Overview page exists. */
export const Route = createFileRoute('/_app/')({
  beforeLoad: () => {
    throw redirect({ to: '/orders', replace: true });
  },
});
