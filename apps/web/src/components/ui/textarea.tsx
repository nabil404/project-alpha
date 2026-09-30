import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-16 w-full min-w-0 resize-y rounded-md border border-border-strong bg-surface px-4 py-2 text-body text-ink transition-colors duration-[120ms] placeholder:text-ink-muted',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
