import { useState, type ChangeEvent } from 'react';
import { Check, Plus, Upload, X } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PRODUCT_IMAGE_MAX_COUNT, type Product } from '@app/shared';

import { Button } from '@/components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import type { ProductFormValues } from '../product-form';
import { photoAccept, usePhotoUpload } from '../use-photo-upload';

interface VariantImagePickerProps {
  /** Absent for a product not saved yet: it has no photos to pick from. */
  product?: Product;
  value: string | null;
  onChange: (imageId: string | null) => void;
  /** "S" or "M / Short", for the labels. */
  variant: string;
}

const thumb = 'size-12 shrink-0 overflow-hidden rounded-md';

/** A variant's own photo, picked from the product's photos or uploaded here. */
export function VariantImagePicker({ product, value, onChange, variant }: VariantImagePickerProps) {
  const { t } = useTranslation('catalog');
  const [open, setOpen] = useState(false);
  const image = product?.images.find((i) => i.id === value);

  if (!product) {
    return (
      <span
        title={t('imagePicker.saveFirst')}
        className={cn(thumb, 'block border border-dashed border-border-strong bg-surface-sunken')}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {image ? (
          <button
            type="button"
            aria-label={t('imagePicker.change', { variant })}
            className={cn(thumb, 'cursor-pointer')}
          >
            <img src={image.thumbnailUrl} alt="" className="size-full object-cover" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('imagePicker.add', { variant })}
            className={cn(
              thumb,
              'flex cursor-pointer flex-col items-center justify-center border border-dashed border-accent bg-surface text-[0.625rem] leading-3 font-medium text-accent hover:bg-accent-soft',
            )}
          >
            <Plus aria-hidden className="size-4" strokeWidth={1.5} />
            {t('imagePicker.addShort')}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-85">
        {open && (
          <PickerBody
            product={product}
            value={value}
            variant={variant}
            onPick={(imageId) => {
              onChange(imageId);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function PickerBody({
  product,
  value,
  variant,
  onPick,
}: {
  product: Product;
  value: string | null;
  variant: string;
  onPick: (imageId: string | null) => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  // The default as the page holds it, which may be unsaved.
  const defaultId = useWatch<ProductFormValues, 'coverImageId'>({ name: 'coverImageId' });
  const [selected, setSelected] = useState(value);
  const { uploadFile, uploading, error } = usePhotoUpload(product.id, product.images.length);
  const full = product.images.length >= PRODUCT_IMAGE_MAX_COUNT;
  const selectedNumber = product.images.findIndex((i) => i.id === selected) + 1;

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const uploaded = await uploadFile(file);
    if (uploaded) onPick(uploaded.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex grow flex-col gap-0.5">
          <span className="text-heading">{t('imagePicker.title', { variant })}</span>
          <span className="text-small text-ink-muted">{t('imagePicker.description')}</span>
        </div>
        <PopoverClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-ink-muted"
            aria-label={t('common:actions.close')}
          >
            <X aria-hidden strokeWidth={1.5} />
          </Button>
        </PopoverClose>
      </div>

      {product.images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {product.images.map((image, index) => {
            const pressed = image.id === selected;
            const isCover = image.id === defaultId;
            return (
              <button
                key={image.id}
                type="button"
                aria-pressed={pressed}
                aria-label={
                  isCover
                    ? t('imagePicker.useDefaultNumbered', { number: index + 1 })
                    : t('imagePicker.useNumbered', { number: index + 1 })
                }
                onClick={() => setSelected(image.id)}
                className={cn(
                  'relative aspect-square cursor-pointer overflow-hidden rounded-md border-2',
                  pressed ? 'border-accent' : 'border-transparent',
                )}
              >
                <img src={image.thumbnailUrl} alt="" className="size-full object-cover" />
                {pressed && (
                  <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-accent text-on-accent">
                    <Check aria-hidden className="size-3" strokeWidth={2} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <label
        className={cn(
          'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border-strong px-3 text-label focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
          full || uploading
            ? 'cursor-not-allowed bg-surface-sunken text-ink-disabled'
            : 'cursor-pointer bg-surface text-ink hover:bg-surface-hover',
        )}
      >
        <Upload aria-hidden className="size-4" strokeWidth={1.5} />
        {uploading ? t('photos.uploading') : t('imagePicker.upload')}
        <input
          type="file"
          accept={photoAccept}
          className="sr-only"
          disabled={full || uploading}
          onChange={(event) => void onUpload(event)}
        />
      </label>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}

      <div className="h-px bg-border" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="link" size="sm" onClick={() => onPick(null)}>
          {t('imagePicker.useDefault')}
        </Button>
        <span className="grow" />
        <PopoverClose asChild>
          <Button type="button" size="sm">
            {t('common:actions.cancel')}
          </Button>
        </PopoverClose>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!selected || selected === value}
          onClick={() => onPick(selected)}
        >
          {selectedNumber > 0
            ? t('imagePicker.useNumbered', { number: selectedNumber })
            : t('imagePicker.use')}
        </Button>
      </div>
    </div>
  );
}
