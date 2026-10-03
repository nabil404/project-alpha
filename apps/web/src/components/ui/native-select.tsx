import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The browser's own select, sized and bordered like Input, for short lists.
 * The native arrow can't be padded, so it is hidden and drawn as an icon.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <span className="relative flex w-full min-w-0">
      <select
        data-slot="native-select"
        className={cn(
          'h-10 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-border-strong bg-surface pr-10 pl-4 text-body text-ink transition-colors duration-[120ms] hover:bg-surface-hover',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled',
          'aria-invalid:border-danger',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute top-3 right-3 size-4 text-ink-muted"
      />
    </span>
  );
}

export { NativeSelect };
