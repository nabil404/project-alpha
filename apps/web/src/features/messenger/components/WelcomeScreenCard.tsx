import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  GREETING_MAX,
  ICE_BREAKERS_MAX,
  welcomeScreenInputSchema,
  type WelcomeScreen,
  type WelcomeScreenInput,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { useZodResolver } from '@/lib/form';
import { useToast } from '@/lib/toast';

import { useSaveWelcomeScreen, useWelcomeScreen } from '../welcome-queries';

const toFormValues = (welcome: WelcomeScreen): WelcomeScreenInput => ({
  greeting: welcome.greeting,
  iceBreakers: welcome.iceBreakers.map(({ kind, question }) => ({ kind, question })),
});

const sectionClass = 'flex flex-col rounded-lg border border-border bg-surface shadow-card';

/**
 * Settings > Messenger > Welcome screen: the greeting and the questions a
 * customer can tap before their first message. Saving updates the Page on
 * Facebook in the background; the chip follows that.
 */
export function WelcomeScreenCard() {
  const welcome = useWelcomeScreen();
  const { forError } = useErrorMessages();

  if (welcome.isPending) {
    return <div aria-busy className={`${sectionClass} h-72`} />;
  }
  if (welcome.isError) {
    return <ErrorBanner>{forError(welcome.error)}</ErrorBanner>;
  }
  // The connect card above covers a shop without a Page.
  if (welcome.data.profileSync.status === 'not_connected') {
    return null;
  }
  return <WelcomeScreenForm welcome={welcome.data} />;
}

function WelcomeScreenForm({ welcome }: { welcome: WelcomeScreen }) {
  const { t } = useTranslation('settings');
  const { forError } = useErrorMessages();
  const { formatDate } = useFormatters();
  const toast = useToast();
  const save = useSaveWelcomeScreen();

  const form = useForm<WelcomeScreenInput>({
    resolver: useZodResolver(welcomeScreenInputSchema),
    defaultValues: toFormValues(welcome),
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'iceBreakers',
    keyName: 'key',
  });
  const greeting = useWatch({ control: form.control, name: 'greeting' });
  // Meta counts the greeting as it is sent: {first_name} becomes {{user_first_name}}.
  const greetingLength = [...greeting.replaceAll('{first_name}', '{{user_first_name}}')].length;

  const { profileSync } = welcome;

  const onSubmit = (values: WelcomeScreenInput) =>
    save.mutate(values, {
      onSuccess: (saved) => {
        form.reset(toFormValues(saved));
        toast.success(t('messenger.welcome.saved'));
      },
    });

  return (
    <section className={sectionClass}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-6 p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-heading">{t('messenger.welcome.title')}</h2>
                <p className="text-body text-ink-muted">{t('messenger.welcome.description')}</p>
                <p className="text-small text-ink-muted">{t('messenger.welcome.editHere')}</p>
              </div>
              {profileSync.status === 'live' && (
                <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-label text-success">
                  <span aria-hidden className="size-1.5 rounded-full bg-success" />
                  {t('messenger.welcome.live')}
                </span>
              )}
              {profileSync.status === 'pending' && (
                <span
                  role="status"
                  className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 text-label text-ink-muted"
                >
                  <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-ink-muted" />
                  {t('messenger.welcome.updating')}
                </span>
              )}
            </div>

            {profileSync.status === 'failed' && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <ErrorBanner className="grow">
                  {t(`messenger.welcome.failed.${profileSync.error ?? 'graph_error'}`)}
                </ErrorBanner>
                <Button
                  type="button"
                  className="shrink-0"
                  disabled={save.isPending}
                  onClick={() => void form.handleSubmit(onSubmit)()}
                >
                  {t('messenger.welcome.retry')}
                </Button>
              </div>
            )}

            {save.error && <ErrorBanner>{forError(save.error)}</ErrorBanner>}

            <FormField
              control={form.control}
              name="greeting"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-baseline justify-between gap-3">
                    <FormLabel>{t('messenger.welcome.greeting')}</FormLabel>
                    <span
                      className={
                        greetingLength > GREETING_MAX
                          ? 'text-small text-danger'
                          : 'text-small text-ink-muted'
                      }
                    >
                      {t('messenger.welcome.count', { count: greetingLength, max: GREETING_MAX })}
                    </span>
                  </div>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormDescription>{t('messenger.welcome.greetingHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <h3 className="text-body font-medium">{t('messenger.welcome.questions')}</h3>
                <span className="text-small text-ink-muted">
                  {t('messenger.welcome.questionsLimit', { max: ICE_BREAKERS_MAX })}
                </span>
              </div>

              <ul className="flex flex-col gap-3">
                {fields.map((row, index) => (
                  <li key={row.key} className="flex flex-col gap-1.5">
                    <FormField
                      control={form.control}
                      name={`iceBreakers.${index}.question`}
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-start gap-1">
                            <FormControl>
                              <Input
                                aria-label={t('messenger.welcome.question', { number: index + 1 })}
                                {...field}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-ink-muted"
                              aria-label={t('messenger.welcome.removeQuestion', {
                                number: index + 1,
                              })}
                              title={t('messenger.welcome.removeQuestion', { number: index + 1 })}
                              onClick={() => remove(index)}
                            >
                              <Trash2 aria-hidden strokeWidth={1.5} />
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <p className="text-small text-ink-muted">
                      {t(
                        row.kind === 'browse'
                          ? 'messenger.welcome.does.browse'
                          : 'messenger.welcome.does.ask',
                      )}
                    </p>
                  </li>
                ))}
              </ul>

              {fields.length < ICE_BREAKERS_MAX && (
                <Button
                  type="button"
                  className="self-start border-accent text-accent"
                  onClick={() => append({ kind: 'ask', question: '' }, { shouldFocus: true })}
                >
                  <Plus aria-hidden strokeWidth={1.5} />
                  {t('messenger.welcome.add')}
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-md bg-surface-sunken p-4">
              <h3 className="text-small font-medium text-ink-muted">
                {t('messenger.welcome.alwaysThere')}
              </h3>
              <dl className="flex flex-col gap-2">
                <div className="flex flex-col">
                  <dt className="text-body font-medium">{t('messenger.welcome.getStarted')}</dt>
                  <dd className="text-small text-ink-muted">
                    {t('messenger.welcome.getStartedHint')}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-body font-medium">{t('messenger.welcome.chatMenu')}</dt>
                  <dd className="text-small text-ink-muted">
                    {t('messenger.welcome.chatMenuLines')}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
            <span className="text-small text-ink-muted">
              {profileSync.syncedAt &&
                t('messenger.welcome.lastUpdated', {
                  date: formatDate(profileSync.syncedAt, 'dateTime'),
                })}
            </span>
            <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                disabled={!form.formState.isDirty || save.isPending}
                onClick={() => {
                  form.reset();
                  save.reset();
                }}
              >
                {t('messenger.welcome.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1 sm:flex-none"
                disabled={(!form.formState.isDirty && !welcome.isDefault) || save.isPending}
              >
                {t('messenger.welcome.save')}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </section>
  );
}
