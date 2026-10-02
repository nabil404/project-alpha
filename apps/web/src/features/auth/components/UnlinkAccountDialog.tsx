import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useToast } from '@/lib/toast';

import { useUnlinkAccount, type SocialProvider } from '../queries';

/**
 * Removing a sign-in method is confirmed: the seller can link it again, but
 * only by going back through the provider. The connected Facebook Page keeps
 * its own token, so unlinking Facebook sign-in leaves it connected.
 */
export function UnlinkAccountDialog({
  accountId,
  provider,
}: {
  /** The account row's id from list-accounts, not the provider's user id. */
  accountId: string;
  provider: SocialProvider;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const { forError } = useErrorMessages();
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const unlink = useUnlinkAccount();
  const name = t(`account.signInMethods.providers.${provider}`);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) unlink.reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="danger" size="sm">
          {t('account.signInMethods.unlink')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('account.unlink.title', { name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('account.unlink.description', { name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {unlink.isError && <ErrorBanner>{forError(unlink.error)}</ErrorBanner>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={unlink.isPending}>
            {t('common:actions.cancel')}
          </AlertDialogCancel>
          {/* A plain button, not AlertDialogAction, so the dialog stays open until the request lands. */}
          <Button
            variant="danger"
            disabled={unlink.isPending}
            onClick={() =>
              unlink.mutate(accountId, {
                onSuccess: () => {
                  setOpen(false);
                  toast.success(t('account.unlink.done', { name }));
                },
              })
            }
          >
            {t('account.unlink.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
