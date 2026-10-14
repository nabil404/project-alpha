import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { messengerProductLink, type Product } from '@app/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// The queries file, not the messenger barrel, which reaches back into the catalog.
import { useFacebookPage } from '@/features/messenger/queries';
import { useToast } from '@/lib/toast';

/** A file-name-safe slug of the product name, or its id when nothing is left. */
function fileSlug(product: Product): string {
  const slug = product.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || product.id;
}

/**
 * A link that opens Messenger with this product chosen, and its QR code.
 * Built in the browser from the connected Page's id, so nothing is stored.
 */
export function MessengerLinkCard({ product }: { product: Product }) {
  const { t } = useTranslation('catalog');
  const appToast = useToast();
  const page = useFacebookPage();
  const pageId = page.data?.page?.pageId;
  const link = pageId ? messengerProductLink(pageId, product.id) : null;
  const [qr, setQr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQr(null);
    if (!link) return;
    let cancelled = false;
    QRCode.toDataURL(link, { width: 256, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  const download = async () => {
    if (!link) return;
    try {
      const url = await QRCode.toDataURL(link, { width: 1024, margin: 2 });
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `messenger-qr-${fileSlug(product)}.png`;
      anchor.click();
    } catch {
      // Plain translated text: useToast().error expects an error value.
      toast.error(t('messengerLink.downloadFailed'));
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      appToast.success(t('messengerLink.copied'));
    } catch {
      // Denied permission or a non-secure context: leave the link selected.
      inputRef.current?.select();
      toast.error(t('messengerLink.copyFailed'));
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('messengerLink.title')}</h2>
        <p className="text-small text-ink-muted">{t('messengerLink.description')}</p>
      </div>
      {!link ? (
        <p className="text-small text-ink-muted">{t('messengerLink.notConnected')}</p>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              readOnly
              value={link}
              aria-label={t('messengerLink.label')}
              className="min-w-0 font-mono text-small"
            />
            <Button type="button" variant="secondary" onClick={() => void copy()}>
              {t('messengerLink.copy')}
            </Button>
          </div>
          <div className="flex items-center gap-4">
            {qr ? (
              <img
                src={qr}
                alt={t('messengerLink.qrLabel')}
                className="size-32 shrink-0 rounded-md border border-border bg-white p-2"
              />
            ) : (
              <div aria-busy className="size-32 shrink-0 rounded-md border border-border" />
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-small text-ink-muted">{t('messengerLink.printHint')}</p>
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                onClick={() => void download()}
              >
                {t('messengerLink.download')}
              </Button>
            </div>
          </div>
          {product.status !== 'active' && (
            <p className="rounded-md bg-surface-sunken p-3 text-small text-ink-muted">
              {t('messengerLink.notPublished')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
