import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  DASHBOARD_LOCALES,
  DATE_FORMATS,
  dashboardLocaleSchema,
  defaultDashboardLocale,
  formatShopDate,
  regionDefaults,
  updateGeneralSettingsSchema,
  type DashboardLocale,
  type GeneralSettings,
} from '@app/shared';
import { z } from 'zod';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Combobox } from '@/components/ui/combobox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { NativeSelect } from '@/components/ui/native-select';
import { sessionQueryOptions } from '@/features/auth';
import { useErrorMessages } from '@/i18n/error-keys';
import { dateFnsLocale, useFormatters } from '@/lib/format';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';

import { useUpdateAccountPreferences, useUpdateGeneralSettings } from '../queries';
import {
  nativeLanguageName,
  useCountryName,
  useCountryOptions,
  useCurrencyOptions,
  useTimeZoneOptions,
} from '@/lib/region-options';
import { SaveBar } from './ShopProfileCard';

/**
 * The region fields, plus the signed-in person's own language: shown here, as
 * the design has it, but saved to their account rather than the shop. Blank
 * follows the shop's country.
 */
const regionSchema = updateGeneralSettingsSchema
  .pick({ country: true, currency: true, timeZone: true, dateFormat: true })
  .required()
  .extend({ language: z.union([z.literal(''), dashboardLocaleSchema]) });

type RegionFormValues = z.infer<typeof regionSchema>;

const serverFields = ['country', 'currency', 'timeZone', 'dateFormat'] as const;

/**
 * Settings > General: where the shop trades. Picking a country fills in its
 * currency, time zone and date format; each can be changed after. The
 * currency is fixed once the shop has an order.
 */
export function RegionCard({ settings }: { settings: GeneralSettings }) {
  const { t } = useTranslation(['settings', 'common']);
  const { forError, forField } = useErrorMessages();
  const { locale } = useFormatters();
  const session = useQuery(sessionQueryOptions());
  const update = useUpdateGeneralSettings();
  const updatePreferences = useUpdateAccountPreferences();

  const savedLanguage = dashboardLocaleSchema.safeParse(session.data?.user.locale).data ?? '';
  const toFormValues = (
    saved: GeneralSettings,
    language: DashboardLocale | '',
  ): RegionFormValues => ({
    country: saved.country,
    currency: saved.currency,
    timeZone: saved.timeZone,
    dateFormat: saved.dateFormat,
    language,
  });

  const form = useForm<RegionFormValues>({
    resolver: useZodResolver(regionSchema),
    defaultValues: toFormValues(settings, savedLanguage),
  });
  const [country, currency, timeZone] = useWatch({
    control: form.control,
    name: ['country', 'currency', 'timeZone'],
  });

  const countryName = useCountryName();
  const countryOptions = useCountryOptions();
  const currencyOptions = useCurrencyOptions();
  const timeZones = useTimeZoneOptions(country);
  const timeZoneGroups = useMemo(
    () => [
      {
        heading: t('general.region.zonesIn', { country: countryName(country) }),
        options: timeZones.local,
      },
      { heading: t('general.region.otherZones'), options: timeZones.other },
    ],
    [t, countryName, country, timeZones],
  );
  const now = useMemo(() => new Date(), []);

  const onCountryChange = (next: string) => {
    form.setValue('country', next, { shouldDirty: true, shouldValidate: true });
    const defaults = regionDefaults(next);
    const options = { shouldDirty: true, shouldValidate: true };
    if (!settings.currencyLocked) form.setValue('currency', defaults.currency, options);
    form.setValue('timeZone', defaults.timeZone, options);
    form.setValue('dateFormat', defaults.dateFormat, options);
  };

  const pending = update.isPending || updatePreferences.isPending;
  const failure = update.error ?? updatePreferences.error;

  const onSubmit = async ({ language, ...region }: RegionFormValues) => {
    update.reset();
    updatePreferences.reset();
    try {
      const saved = await update.mutateAsync(region);
      if (language !== savedLanguage) {
        await updatePreferences.mutateAsync({ locale: language || null });
      }
      form.reset(toFormValues(saved, language));
    } catch (error) {
      if (applyServerFieldErrors(error, form.setError, serverFields, forField)) update.reset();
    }
  };

  const currencyChanged = currency !== settings.currency;

  return (
    <section className="flex flex-col rounded-lg border border-border bg-surface shadow-card">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-heading">{t('general.region.title')}</h2>
              <p className="text-body text-ink-muted">{t('general.region.description')}</p>
            </div>

            {failure && <ErrorBanner>{forError(failure)}</ErrorBanner>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="country"
                render={({ field: { onChange: _onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>{t('general.region.country')}</FormLabel>
                    <FormControl>
                      <Combobox
                        {...field}
                        onValueChange={onCountryChange}
                        options={countryOptions}
                        searchPlaceholder={t('general.region.searchCountry')}
                        emptyText={t('general.noMatch')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>{t('general.region.currency')}</FormLabel>
                    <FormControl>
                      <Combobox
                        {...field}
                        onValueChange={onChange}
                        options={currencyOptions}
                        searchPlaceholder={t('general.region.searchCurrency')}
                        emptyText={t('general.noMatch')}
                        disabled={settings.currencyLocked}
                      />
                    </FormControl>
                    {settings.currencyLocked ? (
                      <FormDescription>{t('general.region.currencyLocked')}</FormDescription>
                    ) : (
                      currencyChanged && (
                        <FormDescription className="text-warning">
                          {t('general.region.currencyChange')}
                        </FormDescription>
                      )
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timeZone"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>{t('general.region.timeZone')}</FormLabel>
                    <FormControl>
                      <Combobox
                        {...field}
                        onValueChange={onChange}
                        options={timeZoneGroups}
                        searchPlaceholder={t('general.region.searchTimeZone')}
                        emptyText={t('general.noMatch')}
                        contentClassName="w-80"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dateFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('general.region.dateFormat')}</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        {DATE_FORMATS.map((dateFormat) => (
                          <option key={dateFormat} value={dateFormat}>
                            {formatShopDate(now, {
                              dateFormat,
                              timeZone,
                              locale: dateFnsLocale(locale),
                            })}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('general.region.language')}</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="">
                          {t('general.region.languageAuto', {
                            language: nativeLanguageName(defaultDashboardLocale(country)),
                          })}
                        </option>
                        {DASHBOARD_LOCALES.map((language) => (
                          <option key={language} value={language}>
                            {nativeLanguageName(language)}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormDescription>{t('general.region.languageHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <SaveBar
            dirty={form.formState.isDirty}
            pending={pending}
            saved={update.isSuccess}
            onCancel={() => {
              form.reset();
              update.reset();
              updatePreferences.reset();
            }}
          />
        </form>
      </Form>
    </section>
  );
}
