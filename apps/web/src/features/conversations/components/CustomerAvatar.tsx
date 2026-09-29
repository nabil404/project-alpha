import { UserRound } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * The customer's Facebook picture over their initials, or a person icon until
 * Facebook shares a name. The picture link expires after a few days, so one
 * that fails to load leaves the initials showing.
 */
export function CustomerAvatar({
  name,
  pictureUrl,
  className,
}: {
  name: string | null;
  pictureUrl: string | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
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
        'relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-sunken text-label text-ink-muted',
        className,
      )}
    >
      {initials || <UserRound className="size-5" strokeWidth={1.5} />}
      {pictureUrl && pictureUrl !== failedUrl && (
        <img
          src={pictureUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(pictureUrl)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
