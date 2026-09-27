import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

/** A failed request, above the form it belongs to. Field errors stay on their fields. */
export function ErrorBanner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-md bg-danger-soft px-4 py-3 text-small text-danger',
        className,
      )}
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
      <p>{children}</p>
    </div>
  );
}
