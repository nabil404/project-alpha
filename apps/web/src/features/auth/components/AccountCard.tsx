import { useQuery } from '@tanstack/react-query';

import { Avatar } from '@/components/Avatar';

import { sessionQueryOptions } from '../queries';

/** The signed-in seller, at the foot of the sidebar. */
export function AccountCard() {
  const { data: session } = useQuery(sessionQueryOptions());
  if (!session) {
    return null;
  }
  const { name, email, image } = session.user;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-3">
      <Avatar name={name} image={image ?? null} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body font-medium">{name}</span>
        <span className="truncate text-small text-ink-muted">{email}</span>
      </span>
    </div>
  );
}
