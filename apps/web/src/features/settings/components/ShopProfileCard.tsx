import { useState, type ChangeEvent } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Store, Upload } from 'lucide-react';
import {
  LOGO_ACCEPTED_TYPES,
  LOGO_MAX_BYTES,
  LOGO_MIN_SIDE,
  NAME_MAX_LENGTH,
  PICKUP_ADDRESS_MAX_LENGTH,
  updateGeneralSettingsSchema,
  type ErrorCode,
  type GeneralSettings,
  type UpdateGeneralSettings,
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';

import { useRemoveLogo, useUpdateGeneralSettings, useUploadLogo } from '../queries';
import { PhoneField } from './PhoneField';

const profileSchema = updateGeneralSettingsSchema.pick({
  name: true,
  contactPhone: true,
  pickupAddress: true,
});

/** Every field is a string in the form; the schema turns a blank one into a clear. */
interface ProfileFormValues {
  name: string;
  contactPhone: string;
  pickupAddress: string;
}

const serverFields = ['name', 'contactPhone', 'pickupAddress'] as const;
const acceptedTypes: readonly string[] = LOGO_ACCEPTED_TYPES;

const toFormValues = (settings: GeneralSettings): ProfileFormValues => ({
  name: settings.name,
  contactPhone: settings.contactPhone ?? '',
  pickupAddress: settings.pickupAddress ?? '',
});

/** Settings > General: what customers see of the shop in order summaries and receipts. */
export function ShopProfileCard({ settings }: { settings: GeneralSettings }) {
  const { t } = useTranslation(['settings', 'common']);
  const { forError, forCode, forField } = useErrorMessages();
  const update = useUpdateGeneralSettings();
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const [fileError, setFileError] = useState<ErrorCode | null>(null);

  const form = useForm<ProfileFormValues, unknown, UpdateGeneralSettings>({
    // The schema's input is `unknown` per clearable field (it preprocesses
    // blanks), and resolver types are invariant in their input, hence the cast.
    resolver: useZodResolver(profileSchema) as unknown as Resolver<
      ProfileFormValues,
      unknown,
      UpdateGeneralSettings
    >,
    defaultValues: toFormValues(settings),
  });

  const onSubmit = (values: UpdateGeneralSettings) =>
    update.mutate(values, {
      // The saved (trimmed, normalized) values become the baseline, so Save and Cancel go quiet.
      onSuccess: (saved) => form.reset(toFormValues(saved)),
      onError: (error) => {
        if (applyServerFieldErrors(error, form.setError, serverFields, forField)) update.reset();
      },
    });

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared, so picking the same file again after a failure uploads again.
    event.target.value = '';
    if (!file) return;

    remove.reset();
    upload.reset();
    if (!acceptedTypes.includes(file.type)) {
      setFileError('LOGO_UNSUPPORTED_TYPE');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setFileError('LOGO_TOO_LARGE');
      return;
    }
    setFileError(null);
    upload.mutate(file);
  };

  const logoBusy = upload.isPending || remove.isPending;
  const logoError = fileError
    ? forCode(fileError, { minSide: LOGO_MIN_SIDE })
    : upload.isError
      ? forError(upload.error)
      : remove.isError
        ? forError(remove.error)
        : null;

  return (
    <section className="flex flex-col rounded-lg border border-border bg-surface shadow-card">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-heading">{t('general.profile.title')}</h2>
              <p className="text-body text-ink-muted">{t('general.profile.description')}</p>
            </div>

            {logoError && <ErrorBanner>{logoError}</ErrorBanner>}
            {update.isError && <ErrorBanner>{forError(update.error)}</ErrorBanner>}

            <div className="flex flex-wrap items-center gap-4">
              {settings.logo ? (
                <img
                  src={settings.logo}
                  alt={t('general.profile.logoAlt')}
                  className={`size-16 shrink-0 rounded-lg border border-border object-cover ${logoBusy ? 'opacity-50' : ''}`}
                />
              ) : (
                <span
                  aria-hidden
                  className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-sunken text-ink-muted"
                >
                  <Store className="size-6" strokeWidth={1.5} />
                </span>
              )}
              <div className="flex min-w-40 flex-1 flex-col gap-0.5">
                <span className="text-label font-medium">{t('general.profile.logo')}</span>
                <span className="text-small text-ink-muted">
                  {t('general.profile.logoHint', { minSide: LOGO_MIN_SIDE })}
                </span>
              </div>
              <div className="flex gap-2" aria-busy={logoBusy}>
                <label
                  className={`inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-body font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
                    logoBusy
                      ? 'cursor-not-allowed text-ink-disabled'
                      : 'cursor-pointer hover:bg-surface-hover'
                  }`}
                >
                  <Upload aria-hidden className="size-4" strokeWidth={1.5} />
                  {t('general.profile.uploadLogo')}
                  <input
                    type="file"
                    accept={LOGO_ACCEPTED_TYPES.join(',')}
                    className="sr-only"
                    disabled={logoBusy}
                    onChange={onPickFile}
                  />
                </label>
                {settings.logo && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-danger"
                    disabled={logoBusy}
                    onClick={() => {
                      setFileError(null);
                      upload.reset();
                      remove.mutate();
                    }}
                  >
                    {t('general.profile.removeLogo')}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('general.profile.name')}</FormLabel>
                    <FormControl>
                      <Input autoComplete="organization" maxLength={NAME_MAX_LENGTH} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('general.profile.phone')}</FormLabel>
                    <FormControl>
                      <PhoneField
                        {...field}
                        defaultCountry={settings.country}
                        disabled={update.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="pickupAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('general.profile.pickupAddress')}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} maxLength={PICKUP_ADDRESS_MAX_LENGTH} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <SaveBar
            dirty={form.formState.isDirty}
            pending={update.isPending}
            saved={update.isSuccess}
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

/** A card's Cancel and Save, quiet until something changed. Shared with the region card. */
export function SaveBar({
  dirty,
  pending,
  saved,
  onCancel,
}: {
  dirty: boolean;
  pending: boolean;
  saved: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['settings', 'common']);

  return (
    <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
      {saved && !dirty && (
        <span role="status" className="mr-auto text-small text-success">
          {t('general.saved')}
        </span>
      )}
      <Button
        type="button"
        className="flex-1 sm:flex-none"
        disabled={!dirty || pending}
        onClick={onCancel}
      >
        {t('common:actions.cancel')}
      </Button>
      <Button
        type="submit"
        variant="primary"
        className="flex-1 sm:flex-none"
        disabled={!dirty || pending}
      >
        {t('common:actions.save')}
      </Button>
    </div>
  );
}
