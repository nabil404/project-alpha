import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-body font-medium whitespace-nowrap transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-sunken disabled:text-ink-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent-hover',
        secondary: 'border border-border-strong bg-surface text-ink hover:bg-surface-hover',
        ghost: 'text-ink hover:bg-surface-hover',
        danger: 'border border-border-strong bg-surface text-danger hover:bg-danger-soft',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-label',
        icon: 'size-10',
        'icon-sm': 'size-8',
      },
    },
    // After the size classes, so an inline link isn't padded like a button.
    compoundVariants: [{ variant: 'link', class: 'h-auto px-0' }],
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
