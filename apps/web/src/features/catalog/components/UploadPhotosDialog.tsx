import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import { Check, CircleAlert, ImageIcon, Plus, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_IMAGE_MAX_COUNT, type Product } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useErrorMessages } from '@/i18n/error-keys';
import { ApiError } from '@/lib/api-error';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { useUploadProductImage } from '../queries';
import { checkPhotoFile, photoAccept } from '../use-photo-upload';

type Status = 'waiting' | 'uploading' | 'done' | 'failed';

interface Item {
  key: string;
  file: File;
  preview: string;
  status: Status;
  progress: number;
  error?: string;
}

interface UploadPhotosDialogProps {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Add photos: pick or drop files, check them over, then upload them one after
 * another. Each upload lands on its own, so a failure keeps the ones before it
 * and can be retried alone.
 */
export function UploadPhotosDialog({ product, open, onOpenChange }: UploadPhotosDialogProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);

  const close = () => {
    if (running) return;
    onOpenChange(false);
  };

  // Previews are object URLs; free them when the dialog lets go of its files.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (!open) {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.preview));
      setItems([]);
    }
  }, [open]);
  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.preview)), []);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        className="max-w-170 gap-0 p-0"
        onInteractOutside={(event) => running && event.preventDefault()}
        onEscapeKeyDown={(event) => running && event.preventDefault()}
      >
        <UploadBody
          product={product}
          items={items}
          setItems={setItems}
          running={running}
          setRunning={setRunning}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function UploadBody({
  product,
  items,
  setItems,
  running,
  setRunning,
  onDone,
}: {
  product: Product;
  items: Item[];
  setItems: Dispatch<SetStateAction<Item[]>>;
  running: boolean;
  setRunning: (running: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forCode, forError } = useErrorMessages();
  const { formatFileSize } = useFormatters();
  const toast = useToast();
  const upload = useUploadProductImage(product.id);
  const inputId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const existing = product.images.length;
  // Photos already uploaded from this dialog are in `existing` once the product refetches.
  const pendingCount = items.filter((i) => i.status !== 'done').length;
  const room = Math.max(PRODUCT_IMAGE_MAX_COUNT - existing - pendingCount, 0);

  const addFiles = (files: File[]) => {
    setNotice(null);
    const refused = files
      .map((file) => ({ file, code: checkPhotoFile(file) }))
      .filter((r) => r.code !== null);
    const fine = files.filter((file) => checkPhotoFile(file) === null);
    const taken = fine.slice(0, room);

    if (refused.length > 0) {
      setNotice(
        t('upload.refused', {
          files: refused.map((r) => r.file.name).join(', '),
          reason: forCode(refused[0]!.code!),
        }),
      );
    } else if (taken.length < fine.length) {
      setNotice(forCode('PRODUCT_IMAGE_LIMIT_REACHED', { max: PRODUCT_IMAGE_MAX_COUNT }));
    }

    const added = taken.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
      status: 'waiting' as const,
      progress: 0,
    }));
    setItems((current) => [...current, ...added]);
    if (added[0] && !selected) setSelected(added[0].key);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    // Cleared, so picking the same file again after removing it adds it again.
    event.target.value = '';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!running) addFiles(Array.from(event.dataTransfer.files));
  };

  const update = (key: string, patch: Partial<Item>) =>
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const remove = (key: string) => {
    setItems((current) => {
      const item = current.find((i) => i.key === key);
      if (item) URL.revokeObjectURL(item.preview);
      return current.filter((i) => i.key !== key);
    });
    if (selected === key) setSelected(null);
  };

  /** Uploads the given items in order; stops early only when cancelled. */
  const run = async (queue: Item[]) => {
    setRunning(true);
    setNotice(null);
    const controller = new AbortController();
    abort.current = controller;
    let failed = false;
    let uploaded = 0;

    for (const item of queue) {
      if (controller.signal.aborted) break;
      setSelected(item.key);
      update(item.key, { status: 'uploading', progress: 0, error: undefined });
      try {
        await upload.mutateAsync({
          file: item.file,
          signal: controller.signal,
          onProgress: (progress) => update(item.key, { progress }),
        });
        update(item.key, { status: 'done', progress: 1 });
        uploaded += 1;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          update(item.key, { status: 'waiting', progress: 0 });
          break;
        }
        failed = true;
        update(item.key, {
          status: 'failed',
          progress: 0,
          error: error instanceof ApiError ? forError(error) : t('upload.connection'),
        });
      }
    }

    abort.current = null;
    setRunning(false);
    if (!failed && !controller.signal.aborted) {
      if (uploaded > 0) toast.success(t('upload.added', { count: uploaded }));
      onDone();
    }
  };

  const cancel = () => {
    abort.current?.abort();
    // What already landed stays on the product; the list keeps only what didn't.
    setItems((current) => current.filter((i) => i.status !== 'done'));
  };

  const waiting = items.filter((i) => i.status === 'waiting' || i.status === 'failed');
  const done = items.filter((i) => i.status === 'done').length;
  const failedCount = items.filter((i) => i.status === 'failed').length;
  const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0);
  const sentBytes = items.reduce(
    (sum, i) => sum + (i.status === 'done' ? i.file.size : i.file.size * i.progress),
    0,
  );
  const overall = totalBytes > 0 ? Math.round((sentBytes / totalBytes) * 100) : 0;
  const current = items.find((i) => i.key === selected) ?? items[0];
  const started = items.some((i) => i.status !== 'waiting');

  return (
    <>
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start gap-3">
          <div className="flex grow flex-col gap-0.5">
            <DialogTitle>{t('upload.title')}</DialogTitle>
            <DialogDescription className="text-small">
              {t('upload.description', {
                name: product.name,
                count: existing,
                room: Math.max(PRODUCT_IMAGE_MAX_COUNT - existing, 0),
              })}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 text-ink-muted"
              aria-label={t('common:actions.close')}
              disabled={running}
            >
              <X aria-hidden className="size-5" strokeWidth={1.5} />
            </Button>
          </DialogClose>
        </div>

        {notice && <ErrorBanner>{notice}</ErrorBanner>}

        {items.length === 0 ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex h-75 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center',
              dragging ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface-sunken',
            )}
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Upload aria-hidden className="size-7" strokeWidth={1.5} />
            </span>
            <span className="text-heading">{t('upload.drop')}</span>
            <span className="text-small text-ink-muted">{t('upload.or')}</span>
            <label
              htmlFor={inputId}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-body font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
                room === 0
                  ? 'cursor-not-allowed text-ink-disabled'
                  : 'cursor-pointer hover:bg-surface-hover',
              )}
            >
              <ImageIcon aria-hidden className="size-4" strokeWidth={1.5} />
              {t('upload.select')}
            </label>
            <span className="text-small text-ink-muted">{t('upload.hint')}</span>
          </div>
        ) : (
          <>
            {current && <Preview item={current} formatFileSize={formatFileSize} />}
            <div
              className="flex flex-col gap-2"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-label">{t('upload.count', { count: items.length })}</span>
                {!running && room > 0 && (
                  <label
                    htmlFor={inputId}
                    className="inline-flex cursor-pointer items-center gap-1 text-label text-link focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
                  >
                    <Plus aria-hidden className="size-3.5" strokeWidth={1.5} />
                    {t('upload.addMore')}
                  </label>
                )}
              </div>
              <ul
                aria-label={t('upload.selected')}
                className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1"
              >
                {items.map((item) => (
                  <ItemRow
                    key={item.key}
                    item={item}
                    active={item.key === current?.key}
                    running={running}
                    onSelect={() => setSelected(item.key)}
                    onRemove={() => remove(item.key)}
                    onRetry={() => void run([item])}
                    formatFileSize={formatFileSize}
                  />
                ))}
              </ul>
            </div>
            <p className="text-small text-ink-muted">{t('upload.listHint')}</p>
          </>
        )}
        <input
          id={inputId}
          type="file"
          accept={photoAccept}
          multiple
          className="sr-only"
          disabled={running || room === 0}
          onChange={onPick}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-4">
        {running || (started && failedCount > 0) ? (
          <div className="flex min-w-48 grow flex-col gap-1.5">
            <span className="flex justify-between text-small">
              <span className="font-medium">
                {running
                  ? t('upload.progress', {
                      current: Math.min(done + 1, items.length),
                      total: items.length,
                    })
                  : t('upload.finished', { done, total: items.length })}
                {failedCount > 0 && t('upload.failedCount', { count: failedCount })}
              </span>
              <span className="text-ink-muted tabular-nums">
                {t('upload.percent', { value: overall })}
              </span>
            </span>
            <ProgressBar value={overall} label={t('upload.overall')} />
          </div>
        ) : (
          <span className="grow text-small text-ink-muted">
            {items.length === 0
              ? t('upload.none')
              : t('upload.summary', { count: items.length, size: formatFileSize(totalBytes) })}
          </span>
        )}

        {running ? (
          <>
            <Button type="button" onClick={cancel}>
              {t('upload.cancelUpload')}
            </Button>
            <Button type="button" variant="primary" disabled>
              {t('photos.uploading')}
            </Button>
          </>
        ) : (
          <>
            <DialogClose asChild>
              <Button type="button">
                {started ? t('upload.done') : t('common:actions.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="primary"
              disabled={waiting.length === 0}
              onClick={() => void run(waiting)}
            >
              <Upload aria-hidden strokeWidth={1.5} />
              {failedCount > 0 && waiting.length === failedCount
                ? t('upload.retryFailed', { count: failedCount })
                : t('upload.submit', { count: waiting.length })}
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function Preview({
  item,
  formatFileSize,
}: {
  item: Item;
  formatFileSize: (bytes: number) => string;
}) {
  const { t } = useTranslation('catalog');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex h-80 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken">
        <img
          key={item.key}
          src={item.preview}
          alt={t('upload.previewOf', { name: item.file.name })}
          className="max-h-full max-w-full object-contain"
          onLoad={(event) =>
            setSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })
          }
        />
        {item.status === 'uploading' && (
          <span className="absolute inset-x-4 bottom-4 flex flex-col gap-1.5 rounded-md bg-surface px-3 py-2 shadow-card">
            <span className="flex justify-between text-small">
              <span>{t('photos.uploading')}</span>
              <span className="tabular-nums">
                {t('upload.percent', { value: Math.round(item.progress * 100) })}
              </span>
            </span>
            <ProgressBar value={item.progress * 100} label={item.file.name} />
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-small text-ink-muted">
        <span className="font-medium text-ink">{item.file.name}</span>
        <span>
          {size
            ? t('upload.meta', { w: size.w, h: size.h, size: formatFileSize(item.file.size) })
            : formatFileSize(item.file.size)}
        </span>
      </p>
    </div>
  );
}

function ItemRow({
  item,
  active,
  running,
  onSelect,
  onRemove,
  onRetry,
  formatFileSize,
}: {
  item: Item;
  active: boolean;
  running: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRetry: () => void;
  formatFileSize: (bytes: number) => string;
}) {
  const { t } = useTranslation('catalog');
  const size = formatFileSize(item.file.size);

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-1.5',
        active ? 'bg-accent-soft' : 'hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        aria-pressed={active}
        aria-label={t('upload.show', { name: item.file.name })}
        onClick={onSelect}
        className="flex min-w-0 grow cursor-pointer items-center gap-3 text-left"
      >
        <img
          src={item.preview}
          alt=""
          className="size-10 shrink-0 rounded-sm bg-surface-sunken object-cover"
        />
        <span className="flex min-w-0 grow flex-col">
          <span className={cn('truncate text-body', active ? 'font-semibold' : 'font-medium')}>
            {item.file.name}
          </span>
          {item.status === 'waiting' && (
            <span className="text-small text-ink-muted">
              {running ? t('upload.waiting', { size }) : size}
            </span>
          )}
          {item.status === 'uploading' && (
            <span className="flex flex-col gap-1 pt-0.5">
              <span className="flex justify-between text-small text-ink-muted">
                <span>{t('upload.uploadingSize', { size })}</span>
                <span className="tabular-nums">
                  {t('upload.percent', { value: Math.round(item.progress * 100) })}
                </span>
              </span>
              <ProgressBar value={item.progress * 100} label={item.file.name} />
            </span>
          )}
          {item.status === 'done' && (
            <span className="flex items-center gap-1 text-small text-success">
              <Check aria-hidden className="size-3.5" strokeWidth={1.5} />
              {t('upload.uploaded', { size })}
            </span>
          )}
          {item.status === 'failed' && (
            <span className="flex items-start gap-1.5 text-small text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
              {item.error}
            </span>
          )}
        </span>
      </button>
      {item.status === 'failed' && !running && (
        <Button type="button" variant="link" size="sm" onClick={onRetry}>
          {t('upload.retry')}
        </Button>
      )}
      {(item.status === 'waiting' || item.status === 'failed') && !running && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 text-ink-muted"
          aria-label={t('upload.remove', { name: item.file.name })}
          title={t('options.removeShort')}
          onClick={onRemove}
        >
          <X aria-hidden className="size-4.5" strokeWidth={1.5} />
        </Button>
      )}
    </li>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const rounded = Math.round(value);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
      className="block h-1.5 overflow-hidden rounded-full bg-surface-sunken"
    >
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${rounded}%` }}
      />
    </span>
  );
}
