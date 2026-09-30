import { useState } from 'react';
import { ImagePlus, LayoutGrid } from 'lucide-react';
import { useController, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PRODUCT_IMAGE_MAX_COUNT, type Product } from '@app/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { ProductFormValues } from '../product-form';
import { PhotosGalleryDialog } from './PhotosGalleryDialog';
import { PhotoViewer } from './PhotoViewer';
import { UploadPhotosDialog } from './UploadPhotosDialog';

const SHOWN = 4;

/**
 * The product's photos. Uploads and deletes happen as soon as the seller
 * confirms them, and neither makes the page's unsaved edits stale; the
 * default photo is a field of the page and waits for Save. A new product has
 * no id to attach photos to until its first save.
 */
export function PhotosCard({ product }: { product?: Product }) {
  const { t } = useTranslation('catalog');

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card">
      {product ? (
        <PhotoGrid product={product} />
      ) : (
        <>
          <h2 className="text-heading">{t('photos.title')}</h2>
          <p className="text-body text-ink-muted">{t('photos.saveFirst')}</p>
        </>
      )}
    </section>
  );
}

function PhotoGrid({ product }: { product: Product }) {
  const { t } = useTranslation('catalog');
  const { control } = useFormContext<ProductFormValues>();
  const { field: cover } = useController({ control, name: 'coverImageId' });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  const images = product.images;
  const full = images.length >= PRODUCT_IMAGE_MAX_COUNT;
  const hidden = images.length - SHOWN;
  const makeDefault = (imageId: string) => cover.onChange(imageId);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-heading">
          {t('photos.title')}
          {images.length > 0 && (
            <span className="font-normal text-ink-muted">
              {t('photos.count', { count: images.length })}
            </span>
          )}
        </h2>
        {images.length > 0 && (
          <Button
            type="button"
            size="sm"
            className="border-accent text-accent"
            onClick={() => setGalleryOpen(true)}
          >
            <LayoutGrid aria-hidden className="size-3.5" strokeWidth={1.5} />
            {t('photos.showAll', { count: images.length })}
          </Button>
        )}
      </div>

      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {images.slice(0, SHOWN).map((image, index) => {
          const overflow = index === SHOWN - 1 && hidden > 0;
          const isDefault = image.id === cover.value;
          return (
            <li key={image.id} className="relative aspect-square">
              <button
                type="button"
                onClick={() => (overflow ? setGalleryOpen(true) : setViewing(index))}
                aria-label={
                  overflow
                    ? t('photos.moreLabel', { count: images.length })
                    : t('gallery.view', { number: index + 1 })
                }
                className="relative block size-full cursor-pointer overflow-hidden rounded-md"
              >
                <img
                  src={image.thumbnailUrl}
                  alt=""
                  className="size-full bg-surface-sunken object-cover"
                />
                {isDefault && !overflow && (
                  <span className="absolute bottom-1.5 left-1.5 rounded-sm bg-surface px-1.5 text-label text-ink shadow-card">
                    {t('photos.default')}
                  </span>
                )}
                {overflow && (
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center bg-ink/60 text-title text-surface"
                  >
                    {t('photos.more', { count: hidden })}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            disabled={full}
            onClick={() => setUploadOpen(true)}
            className={cn(
              'flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-label',
              full
                ? 'cursor-not-allowed border-border-strong bg-surface-sunken text-ink-disabled'
                : 'cursor-pointer border-accent bg-accent-soft text-accent hover:bg-surface-hover',
            )}
          >
            <ImagePlus aria-hidden className="size-5" strokeWidth={1.5} />
            {t('photos.add')}
          </button>
        </li>
      </ul>
      <p className="text-small text-ink-muted">
        {full ? t('photos.full', { max: PRODUCT_IMAGE_MAX_COUNT }) : t('photos.hint')}
      </p>

      <UploadPhotosDialog product={product} open={uploadOpen} onOpenChange={setUploadOpen} />
      <PhotosGalleryDialog
        product={product}
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        defaultId={cover.value}
        onMakeDefault={makeDefault}
        onView={setViewing}
        onAddPhotos={() => {
          setGalleryOpen(false);
          setUploadOpen(true);
        }}
      />
      <PhotoViewer
        images={images}
        index={viewing}
        onIndexChange={setViewing}
        defaultId={cover.value}
        onMakeDefault={makeDefault}
      />
    </>
  );
}
