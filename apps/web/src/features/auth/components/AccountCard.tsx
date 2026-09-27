import { useQuery } from '@tanstack/react-query';

import { sessionQueryOptions } from '../queries';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
}

/** The signed-in seller, at the foot of the sidebar. */
export function AccountCard() {
  const { data: session } = useQuery(sessionQueryOptions());
  if (!session) {
    return null;
  }
  const { name, email } = session.user;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-label text-accent"
      >
        {initials(name)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body font-medium">{name}</span>
        <span className="truncate text-small text-ink-muted">{email}</span>
      </span>
    </div>
  );
}
