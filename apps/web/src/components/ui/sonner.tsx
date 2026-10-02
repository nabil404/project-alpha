import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Sonner, unstyled and dressed in the design tokens, so it follows
 * `[data-theme]` like every other surface without a theme prop of its own.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-start gap-3 rounded-md border border-border bg-surface px-4 py-3 text-small text-ink shadow-popover sm:w-(--width)',
          icon: 'mt-0.5 size-4 shrink-0 [&>svg]:size-4',
          content: 'flex min-w-0 grow flex-col gap-0.5',
          title: 'font-medium',
          description: 'text-ink-muted',
          success: '[&_[data-icon]]:text-success',
          error: '[&_[data-icon]]:text-danger',
          closeButton: 'cursor-pointer',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
