import { UserRound } from 'lucide-react';

import { cn } from '@/lib/utils';

/** The first letters of the first two words, or a person icon until Facebook shares a name. */
export function CustomerAvatar({ name, className }: { name: string | null; className?: string }) {
  const initials = name
    ?.trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-label text-ink-muted',
        className,
      )}
    >
      {initials || <UserRound className="size-5" strokeWidth={1.5} />}
    </span>
  );
}
