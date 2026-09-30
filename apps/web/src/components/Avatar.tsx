import { useState } from 'react';

import { cn } from '@/lib/utils';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
}

/**
 * The seller's photo, or their initials when there is none or it fails to
 * load (a Google photo URL can expire). Decorative: the name is always beside it.
 */
export function Avatar({
  name,
  image,
  className,
}: {
  name: string;
  image: string | null;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = image !== null && image !== failedSrc;

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-label text-accent',
        className,
      )}
    >
      {showImage ? (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailedSrc(image)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
