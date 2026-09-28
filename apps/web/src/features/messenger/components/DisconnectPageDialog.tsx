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

import { useDisconnectPage } from '../queries';

/** Disconnecting stops the assistant on the Page, so it is always confirmed. */
export function DisconnectPageDialog({ pageName }: { pageName: string }) {
  const { t } = useTranslation(['settings', 'common']);
  const { forError } = useErrorMessages();
  const [open, setOpen] = useState(false);
  const disconnect = useDisconnectPage();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) disconnect.reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="danger" className="sm:ml-auto">
          {t('messenger.connected.disconnect')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('messenger.disconnect.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('messenger.disconnect.description', { name: pageName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {disconnect.isError && <ErrorBanner>{forError(disconnect.error)}</ErrorBanner>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disconnect.isPending}>
            {t('common:actions.cancel')}
          </AlertDialogCancel>
          {/* A plain button, not AlertDialogAction, so the dialog stays open until the request lands. */}
          <Button
            variant="danger"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate(undefined, { onSuccess: () => setOpen(false) })}
          >
            {t('messenger.disconnect.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
