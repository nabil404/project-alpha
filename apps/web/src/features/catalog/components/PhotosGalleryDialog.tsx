import { useState } from 'react';
import { Maximize2, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_IMAGE_MAX_COUNT, type Product, type ProductImage } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useErrorMessages } from '@/i18n/error-keys';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { useDeleteProductImage } from '../queries';

interface PhotosGalleryDialogProps {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The default as the page holds it; it's saved with the product. */
  defaultId: string | null;
  onMakeDefault: (imageId: string) => void;
  onView: (index: number) => void;
  onAddPhotos: () => void;
}

/**
 * All photos: see each one, choose the default and delete. Deleting happens
 * straight away; the default is part of the page and waits for Save.
 */
export function PhotosGalleryDialog({
  product,
  open,
  onOpenChange,
  defaultId,
  onMakeDefault,
  onView,
  onAddPhotos,
}: PhotosGalleryDialogProps) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const toast = useToast();
  const remove = useDeleteProductImage(product.id);
  const [deleting, setDeleting] = useState<{ image: ProductImage; number: number } | null>(null);
  const images = product.images;
  const full = images.length >= PRODUCT_IMAGE_MAX_COUNT;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-230 gap-0 p-0">
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-start gap-3">
            <div className="flex grow flex-col gap-0.5">
              <DialogTitle>{t('gallery.title')}</DialogTitle>
              <DialogDescription className="text-small">
                {t('gallery.description', { name: product.name, count: images.length })}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 text-ink-muted"
                aria-label={t('common:actions.close')}
              >
                <X aria-hidden className="size-5" strokeWidth={1.5} />
              </Button>
            </DialogClose>
          </div>

          {remove.isError && <ErrorBanner>{forError(remove.error)}</ErrorBanner>}

          {images.length === 0 ? (
            <p className="py-12 text-center text-body text-ink-muted">{t('gallery.empty')}</p>
          ) : (
            <ul
              role="radiogroup"
              aria-label={t('gallery.defaultGroup')}
              className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4"
            >
              {images.map((image, index) => {
                const isDefault = image.id === defaultId;
                const number = index + 1;
                return (
                  <li key={image.id} className="flex min-w-0 flex-col gap-2">
                    <div
                      className={cn(
                        'relative aspect-square overflow-hidden rounded-md',
                        isDefault && 'outline-2 outline-accent',
                      )}
                    >
                      <img
                        src={image.thumbnailUrl}
                        alt={t('photos.alt', { number })}
                        className="size-full bg-surface-sunken object-cover"
                      />
                      {isDefault && (
                        <span className="absolute top-2 left-2 inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 text-label text-accent">
                          {t('gallery.defaultImage')}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        className="absolute top-2 right-2 border-transparent shadow-card"
                        aria-label={t('gallery.view', { number })}
                        title={t('gallery.fullScreen')}
                        onClick={() => onView(index)}
                      >
                        <Maximize2 aria-hidden strokeWidth={1.5} />
                      </Button>
                    </div>
                    <span className="truncate text-label">
                      {t('gallery.caption', { number, w: image.width, h: image.height })}
                    </span>
                    <div className="-mt-1 flex items-center justify-between">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isDefault}
                        aria-label={t('gallery.makeDefault', { number })}
                        onClick={() => onMakeDefault(image.id)}
                        className={cn(
                          'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full pr-2 pl-1 text-label whitespace-nowrap hover:bg-surface-hover',
                          isDefault ? 'text-accent' : 'text-ink-muted',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'flex size-4.5 items-center justify-center rounded-full border-[1.5px]',
                            isDefault ? 'border-accent' : 'border-border-strong',
                          )}
                        >
                          {isDefault && <span className="size-2 rounded-full bg-accent" />}
                        </span>
                        {t('gallery.default')}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-ink-muted hover:text-danger"
                        aria-label={t('gallery.delete', { number })}
                        title={t('gallery.deleteShort')}
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.reset();
                          setDeleting({ image, number });
                        }}
                      >
                        <Trash2 aria-hidden strokeWidth={1.5} />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-small text-ink-muted">{t('gallery.hint')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-4">
          <span className="grow text-small text-ink-muted">
            {t('gallery.used', { count: images.length, max: PRODUCT_IMAGE_MAX_COUNT })}
          </span>
          <Button type="button" disabled={full} onClick={onAddPhotos}>
            {t('photos.add')}
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="primary">
              {t('gallery.done')}
            </Button>
          </DialogClose>
        </div>

        <AlertDialog
          open={deleting !== null}
          onOpenChange={(next) => {
            if (!next && !remove.isPending) setDeleting(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('gallery.deleteTitle', { number: deleting?.number ?? 0 })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleting?.image.id === defaultId
                  ? t('gallery.deleteDefault')
                  : t('gallery.deleteDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={remove.isPending}>
                {t('common:actions.cancel')}
              </AlertDialogCancel>
              <Button
                type="button"
                variant="danger"
                disabled={remove.isPending}
                onClick={() =>
                  deleting &&
                  remove.mutate(deleting.image.id, {
                    onSuccess: () =>
                      toast.success(t('gallery.deleted', { number: deleting.number })),
                    onSettled: () => setDeleting(null),
                  })
                }
              >
                {t('gallery.deleteConfirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
