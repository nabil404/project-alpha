import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ORDER_NOTE_MAX_LENGTH, type OrderDetail } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessages } from '@/i18n/error-keys';
import { useToast } from '@/lib/toast';

import { useUpdateOrder } from '../queries';

/** The seller's own note on the order. The customer never sees it. */
export function OrderNoteCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const { forError } = useErrorMessages();
  const toast = useToast();
  const update = useUpdateOrder(order.id);
  const saved = order.note ?? '';
  const [draft, setDraft] = useState(saved);
  const [shownFor, setShownFor] = useState(saved);

  // A save, or someone else's, puts a new note in from outside: show it.
  if (shownFor !== saved) {
    setShownFor(saved);
    setDraft(saved);
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate(
            { note: draft, version: order.version },
            { onSuccess: () => toast.success(t('note.saved')) },
          );
        }}
      >
        <Label htmlFor="order-note" className="text-heading">
          {t('note.title')}
        </Label>
        {update.isError && <ErrorBanner>{forError(update.error)}</ErrorBanner>}
        <Textarea
          id="order-note"
          rows={3}
          maxLength={ORDER_NOTE_MAX_LENGTH}
          placeholder={t('note.placeholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p className="text-small text-ink-muted">{t('note.hint')}</p>
        {draft.trim() !== saved && (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft(saved)}>
              {t('note.discard')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {t('note.save')}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
