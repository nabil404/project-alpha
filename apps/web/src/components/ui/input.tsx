import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-md border border-border-strong bg-surface px-4 text-body text-ink transition-colors duration-[120ms] placeholder:text-ink-muted',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
