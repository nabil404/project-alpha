import { toast } from 'sonner';

import { useErrorMessages } from '@/i18n/error-keys';

/**
 * Feedback for a finished action. Every successful save, upload or removal
 * confirms with a `success` toast, so the seller gets the same signal
 * everywhere. `error` is for an action whose own screen can't carry it: a
 * dialog that closes, a page the seller is sent away from, a row that
 * disappears. Errors that belong to a form or a card stay inline in an
 * ErrorBanner.
 *
 * `error` resolves through the message catalog, so the API's English fallback
 * never reaches the seller.
 */
export function useToast() {
  const { forError } = useErrorMessages();

  return {
    success: (message: string) => toast.success(message),
    error: (error: unknown) => toast.error(forError(error)),
  };
}
