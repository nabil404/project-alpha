import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PenLine } from 'lucide-react';
import {
  CUSTOMER_NOTE_MAX_LENGTH,
  createCustomerNoteSchema,
  type CreateCustomerNote,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';
import { useFormatters } from '@/lib/format';

import { useCreateCustomerNote, useCustomerNotes } from '../queries';

const serverFields = ['body'] as const;

/** The team's notes on the customer, newest first, and a box to add one. Customers never see them. */
export function NotesCard({ customerId }: { customerId: string }) {
  const { t } = useTranslation(['customers', 'common']);
  const { forError, forField } = useErrorMessages();
  const { formatDate } = useFormatters();
  const notes = useCustomerNotes(customerId);
  const create = useCreateCustomerNote(customerId);

  const form = useForm<CreateCustomerNote>({
    resolver: useZodResolver(createCustomerNoteSchema),
    defaultValues: { body: '' },
  });

  const onSubmit = (values: CreateCustomerNote) =>
    create.mutate(values, {
      onSuccess: () => form.reset({ body: '' }),
      onError: (error) => {
        if (applyServerFieldErrors(error, form.setError, serverFields, forField)) create.reset();
      },
    });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-heading">{t('notes.title')}</h2>

      {notes.isError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorBanner className="self-stretch">{forError(notes.error)}</ErrorBanner>
          <Button size="sm" onClick={() => void notes.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : notes.isPending ? (
        <span aria-hidden className="h-16 animate-pulse rounded-md bg-surface-sunken" />
      ) : notes.data.length === 0 ? (
        <p className="text-small text-ink-muted">{t('notes.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.data.map((note) => (
            <li
              key={note.id}
              className="flex flex-col gap-1 rounded-md bg-surface-sunken px-4 py-3"
            >
              <p className="text-body break-words whitespace-pre-line">{note.body}</p>
              <span className="text-small text-ink-muted">
                {t('notes.byline', {
                  author: note.author?.name ?? t('notes.formerMember'),
                  date: formatDate(note.createdAt, 'dayMonth'),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3">
          {create.isError && <ErrorBanner>{forError(create.error)}</ErrorBanner>}
          <FormField
            control={form.control}
            name="body"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="sr-only">{t('notes.label')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    maxLength={CUSTOMER_NOTE_MAX_LENGTH}
                    placeholder={t('notes.placeholder')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={create.isPending}>
            <PenLine aria-hidden strokeWidth={1.5} />
            {t('notes.save')}
          </Button>
        </form>
      </Form>
    </section>
  );
}
