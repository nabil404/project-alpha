import type { KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import type { ProductImage } from '@app/shared';

import { cn } from '@/lib/utils';

interface PhotoViewerProps {
  images: ProductImage[];
  /** The photo on show; null closes the viewer. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
  defaultId: string | null;
  onMakeDefault: (imageId: string) => void;
}

const control =
  'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-on-viewer/12 text-on-viewer hover:bg-on-viewer/20 disabled:cursor-not-allowed disabled:opacity-40';

/** One photo at full size on a dark ground, with the others along the bottom. Arrow keys step through. */
export function PhotoViewer({
  images,
  index,
  onIndexChange,
  defaultId,
  onMakeDefault,
}: PhotoViewerProps) {
  const { t } = useTranslation(['catalog', 'common']);
  const image = index === null ? undefined : images[index];
  const open = image !== undefined;
  const count = images.length;

  const step = (by: number) => {
    if (index === null || count === 0) return;
    onIndexChange((index + by + count) % count);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  };

  const isDefault = image?.id === defaultId;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onIndexChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col bg-viewer text-on-viewer"
        >
          {image && index !== null && (
            <>
              <div className="flex h-18 shrink-0 items-center gap-4 px-4 sm:px-6">
                <div className="flex min-w-0 grow items-baseline gap-3">
                  <DialogPrimitive.Title className="truncate text-body font-medium">
                    {t('photos.alt', { number: index + 1 })}
                  </DialogPrimitive.Title>
                  <span className="text-small text-on-viewer-muted tabular-nums">
                    {t('viewer.position', { current: index + 1, total: count })}
                  </span>
                </div>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isDefault}
                  aria-label={t('gallery.makeDefault', { number: index + 1 })}
                  onClick={() => onMakeDefault(image.id)}
                  className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-on-viewer/12 px-3.5 text-label whitespace-nowrap hover:bg-on-viewer/20"
                >
                  <span
                    aria-hidden
                    className="flex size-4.5 items-center justify-center rounded-full border-[1.5px] border-on-viewer"
                  >
                    {isDefault && <span className="size-2 rounded-full bg-on-viewer" />}
                  </span>
                  {t('gallery.default')}
                </button>
                <DialogPrimitive.Close
                  className={control}
                  aria-label={t('viewer.close')}
                  title={t('common:actions.close')}
                >
                  <X aria-hidden className="size-5" strokeWidth={1.5} />
                </DialogPrimitive.Close>
              </div>

              <div className="flex min-h-0 grow items-center gap-3 px-2 sm:gap-6 sm:px-6">
                <button
                  type="button"
                  className={control}
                  aria-label={t('viewer.previous')}
                  disabled={count < 2}
                  onClick={() => step(-1)}
                >
                  <ChevronLeft aria-hidden className="size-5.5" strokeWidth={1.5} />
                </button>
                <div className="flex h-full min-w-0 grow items-center justify-center">
                  <img
                    key={image.id}
                    src={image.url}
                    alt={t('photos.alt', { number: index + 1 })}
                    width={image.width}
                    height={image.height}
                    className="max-h-full max-w-full rounded-md object-contain"
                  />
                </div>
                <button
                  type="button"
                  className={control}
                  aria-label={t('viewer.next')}
                  disabled={count < 2}
                  onClick={() => step(1)}
                >
                  <ChevronRight aria-hidden className="size-5.5" strokeWidth={1.5} />
                </button>
              </div>

              <div className="flex h-26 shrink-0 items-center justify-center gap-2 overflow-x-auto px-4">
                {images.map((thumb, i) => (
                  <button
                    key={thumb.id}
                    type="button"
                    aria-label={t('photos.alt', { number: i + 1 })}
                    aria-current={i === index}
                    onClick={() => onIndexChange(i)}
                    className={cn(
                      'size-16 shrink-0 cursor-pointer overflow-hidden rounded-sm',
                      i === index
                        ? 'border-2 border-on-viewer'
                        : 'border border-on-viewer/16 opacity-60 hover:opacity-100',
                    )}
                  >
                    <img src={thumb.thumbnailUrl} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
