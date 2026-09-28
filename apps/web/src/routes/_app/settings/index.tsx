import { createFileRoute, redirect } from '@tanstack/react-router';

/** Messenger is the only section built so far; General takes this over when it lands. */
export const Route = createFileRoute('/_app/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/messenger', replace: true });
  },
});
