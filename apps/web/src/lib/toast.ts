import { toast } from 'sonner';

import { useErrorMessages } from '@/i18n/error-keys';

/**
 * Feedback for a finished action. Every successful save, upload or removal
 * shows a `success` toast. Use `error` only when the screen can't show it, such
 * as a closing dialog, a page the seller leaves, or a removed row. Form and card
 * errors stay inline in an ErrorBanner. `error` text comes from the message
 * catalog, never the API's English fallback.
 */
export function useToast() {
  const { forError } = useErrorMessages();

  return {
    success: (message: string) => toast.success(message),
    error: (error: unknown) => toast.error(forError(error)),
  };
}
