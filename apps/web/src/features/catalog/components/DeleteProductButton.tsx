import { useState } from 'react';
import { Trash2 } from 'lucide-react';
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

import { useDeleteProduct } from '../queries';

/**
 * Deleting is refused once orders reference the product (PRODUCT_IN_USE);
 * the dialog then stays open and says to archive it instead.
 */
export function DeleteProductButton({
  productId,
  name,
  onDeleted,
}: {
  productId: string;
  name: string;
  onDeleted: () => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const remove = useDeleteProduct(productId);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Not while the request is out: closing would hide its outcome.
        if (remove.isPending) return;
        setOpen(next);
        if (!next) remove.reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="danger">
          <Trash2 aria-hidden strokeWidth={1.5} />
          {t('editor.actions.delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('delete.title', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('delete.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && <ErrorBanner>{forError(remove.error)}</ErrorBanner>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            {t('common:actions.cancel')}
          </AlertDialogCancel>
          {/* A plain button, not AlertDialogAction: that one closes the dialog before the request answers. */}
          <Button
            type="button"
            variant="danger"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  // The seller is sent back to the catalog, where nothing else says it worked.
                  toast.success(t('delete.done', { name }));
                  onDeleted();
                },
              })
            }
          >
            {t('delete.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
