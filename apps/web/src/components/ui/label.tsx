import * as React from 'react';
import { Label as LabelPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'text-label text-ink select-none peer-disabled:cursor-not-allowed peer-disabled:text-ink-disabled',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
