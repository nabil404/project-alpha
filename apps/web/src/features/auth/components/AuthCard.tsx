import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** The card every sign-in, sign-up and email step sits on: a title, one line under it, then the body. */
export function AuthCard({
  icon,
  title,
  description,
  children,
  className,
}: {
  /** Sits above the title, for the cards that report a step rather than ask for input. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex w-full max-w-[440px] flex-col gap-6 rounded-xl border border-border bg-surface p-6 shadow-popover sm:p-8',
        className,
      )}
    >
      {icon}
      <div className="flex flex-col gap-1">
        <h1 className="text-display">{title}</h1>
        {description ? <p className="text-ink-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** The hairline-separated line at the bottom of an auth card: "New here? Create an account". */
export function AuthCardFooter({ children }: { children: ReactNode }) {
  return <p className="border-t border-border pt-6 text-center text-ink-muted">{children}</p>;
}
