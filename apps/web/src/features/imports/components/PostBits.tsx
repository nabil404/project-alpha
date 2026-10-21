import { ImageOff } from 'lucide-react';
import type { ImportPost } from '@app/shared';

import { statusToneClasses, type StatusTone } from '@/i18n/status-tones';
import { cn } from '@/lib/utils';

/** A post's picture: the cover of a product it made, when one has a photo. */
export function PostThumb({ post }: { post: ImportPost }) {
  const cover = post.products.find((product) => product.coverThumbnailUrl)?.coverThumbnailUrl;
  return cover ? (
    <img src={cover} alt="" className="size-12 shrink-0 rounded-md object-cover" />
  ) : (
    <span
      aria-hidden
      className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-ink-muted"
    >
      <ImageOff strokeWidth={1.5} className="size-4" />
    </span>
  );
}

export function Pill({
  tone,
  className,
  children,
}: {
  tone: StatusTone;
  className?: string;
  children: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-label whitespace-nowrap',
        statusToneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
