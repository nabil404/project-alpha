import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  ASSISTANT_NOTES_MAX,
  ASSISTANT_TONES,
  MATCH_CUSTOMER,
  assistantSettingsSchema,
  type AssistantSettings,
  type AssistantSettingsView,
  type AssistantTone,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Select, fieldProps } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';
import { useToast } from '@/lib/toast';

import { useUpdateAssistantSettings } from '../assistant-queries';
import { SaveBar } from './ShopProfileCard';

const TONE_KEYS = {
  friendly: 'assistant.voice.tones.friendly',
  direct: 'assistant.voice.tones.direct',
  formal: 'assistant.voice.tones.formal',
} as const satisfies Record<AssistantTone, string>;

const serverFields = ['tone', 'defaultLanguage', 'notes'] as const;

const toFormValues = ({
  tone,
  defaultLanguage,
  notes,
}: AssistantSettingsView): AssistantSettings => ({
  tone,
  defaultLanguage,
  notes,
});

/**
 * Settings > Order assistant: the tone of its replies, the language it falls
 * back to when the customer's is unclear, and facts it may use. The languages
 * on offer are the ones the API lists as supported.
 */
export function AssistantVoiceCard({ settings }: { settings: AssistantSettingsView }) {
  const { t } = useTranslation(['settings', 'common']);
  const { forError, forField } = useErrorMessages();
  const { locale } = useFormatters();
  const toast = useToast();
  const update = useUpdateAssistantSettings();

  const form = useForm<AssistantSettings>({
    resolver: useZodResolver(assistantSettingsSchema),
    defaultValues: toFormValues(settings),
  });

  const languageOptions = useMemo(() => {
    const names = new Intl.DisplayNames([locale, 'en'], { type: 'language' });
    return [
      { value: MATCH_CUSTOMER, label: t('assistant.voice.matchCustomer') },
      ...settings.supportedLanguages
        .map((code) => ({ value: code, label: names.of(code) ?? code }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    ];
  }, [locale, settings.supportedLanguages, t]);

  const onSubmit = (values: AssistantSettings) =>
    update.mutate(values, {
      // The saved (trimmed) values become the baseline, so Save and Cancel go quiet.
      onSuccess: (saved) => {
        form.reset(toFormValues(saved));
        toast.success(t('assistant.voice.saved'));
      },
      onError: (error) => {
        if (applyServerFieldErrors(error, form.setError, serverFields, forField)) update.reset();
      },
    });

  return (
    <section className="flex flex-col rounded-lg border border-border bg-surface shadow-card">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-heading">{t('assistant.voice.title')}</h2>
              <p className="text-body text-ink-muted">{t('assistant.voice.description')}</p>
            </div>

            {update.isError && <ErrorBanner>{forError(update.error)}</ErrorBanner>}

            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="tone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('assistant.voice.tone')}</FormLabel>
                      <FormControl>
                        <Select
                          {...fieldProps(field)}
                          options={ASSISTANT_TONES.map((tone) => ({
                            value: tone,
                            label: t(TONE_KEYS[tone]),
                          }))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="defaultLanguage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('assistant.voice.defaultLanguage')}</FormLabel>
                      <FormControl>
                        <Select {...fieldProps(field)} options={languageOptions} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('assistant.voice.notes')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        maxLength={ASSISTANT_NOTES_MAX}
                        placeholder={t('assistant.voice.notesPlaceholder')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>{t('assistant.voice.notesHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <SaveBar
            dirty={form.formState.isDirty}
            pending={update.isPending}
            onCancel={() => {
              form.reset();
              update.reset();
            }}
          />
        </form>
      </Form>
    </section>
  );
}
