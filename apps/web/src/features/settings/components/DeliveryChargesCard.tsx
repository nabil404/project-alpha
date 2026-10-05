import { useFieldArray, useForm, useWatch, type Path, type Resolver } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DELIVERY_AREA_NAME_MAX_LENGTH,
  DELIVERY_TIME_MAX_LENGTH,
  saveDeliverySettingsSchema,
  type DeliverySettings,
  type SaveDeliverySettings,
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
import { MoneyInput } from '@/features/catalog';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { useSaveDeliverySettings } from '../delivery-queries';
import { SaveBar } from './ShopProfileCard';

/** Every time is a string in the form; the schema turns a blank one into "none". */
interface AreaRow {
  id?: string;
  areaName: string;
  /** NaN while blank, so the schema reports it. */
  charge: number;
  deliveryTime: string;
}

interface DeliveryFormValues {
  deliveryCharges: AreaRow[];
  everywhereElse: { charge: number; deliveryTime: string };
  freeDeliveryOver: number | null;
}

const toFormValues = (settings: DeliverySettings): DeliveryFormValues => ({
  deliveryCharges: settings.deliveryCharges.map((row) => ({
    id: row.id,
    areaName: row.areaName,
    charge: row.charge,
    deliveryTime: row.deliveryTime ?? '',
  })),
  // A shop that never saved has no everywhere-else charge yet; it is required.
  everywhereElse: {
    charge: settings.everywhereElse?.charge ?? Number.NaN,
    deliveryTime: settings.everywhereElse?.deliveryTime ?? '',
  },
  freeDeliveryOver: settings.freeDeliveryOver,
});

/** Laid out as a table from `md` up; below it, each area is a small card. */
const rowGrid = 'md:grid md:grid-cols-[minmax(0,1fr)_9rem_11rem_2.5rem] md:items-start md:gap-3';

/**
 * Settings > Delivery charges: the areas the shop delivers to, what each costs
 * and how long it takes, "everywhere else", and the free-delivery threshold,
 * all saved together.
 */
export function DeliveryChargesCard({ settings }: { settings: DeliverySettings }) {
  const { t } = useTranslation(['settings', 'common']);
  const { forError, forField } = useErrorMessages();
  const { currencySymbol } = useFormatters();
  const toast = useToast();
  const save = useSaveDeliverySettings();

  const form = useForm<DeliveryFormValues, unknown, SaveDeliverySettings>({
    // The schema's input is `unknown` for each delivery time (it preprocesses
    // blanks), and resolver types are invariant in their input, hence the cast.
    resolver: useZodResolver(saveDeliverySettingsSchema) as unknown as Resolver<
      DeliveryFormValues,
      unknown,
      SaveDeliverySettings
    >,
    defaultValues: toFormValues(settings),
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'deliveryCharges',
    keyName: 'key',
  });
  const names = useWatch({ control: form.control, name: 'deliveryCharges' });

  const serverFields = (): Path<DeliveryFormValues>[] => [
    ...fields.flatMap((_, index) =>
      (['areaName', 'charge', 'deliveryTime'] as const).map(
        (key) => `deliveryCharges.${index}.${key}` as const,
      ),
    ),
    'everywhereElse.charge',
    'everywhereElse.deliveryTime',
    'freeDeliveryOver',
  ];

  const onSubmit = (values: SaveDeliverySettings) =>
    save.mutate(values, {
      // The saved rows carry their ids, so new areas are updates on the next save.
      onSuccess: (saved) => {
        form.reset(toFormValues(saved));
        toast.success(t('delivery.saved'));
      },
      onError: (error) => {
        if (applyServerFieldErrors(error, form.setError, serverFields(), forField)) save.reset();
      },
    });

  const areaLabel = (index: number) => names[index]?.areaName.trim() || t('delivery.area');
  const symbol = currencySymbol();

  return (
    <section className="flex flex-col rounded-lg border border-border bg-surface shadow-card">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-heading">{t('delivery.title')}</h2>
              <p className="text-body text-ink-muted">{t('delivery.description')}</p>
            </div>

            {save.error && <ErrorBanner>{forError(save.error)}</ErrorBanner>}

            <div className="flex flex-col gap-4">
              <div
                aria-hidden
                className={cn('hidden px-3 text-small font-medium text-ink-muted', rowGrid)}
              >
                <span>{t('delivery.area')}</span>
                <span>{t('delivery.charge', { symbol })}</span>
                <span>{t('delivery.time')}</span>
              </div>

              <ul aria-label={t('delivery.areas')} className="flex flex-col gap-3 md:gap-2">
                {fields.map((row, index) => (
                  <li
                    key={row.key}
                    className={cn(
                      'flex flex-col gap-2 rounded-md border border-border p-3 md:border-0 md:p-0 md:px-3',
                      rowGrid,
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-1 md:contents">
                      <FormField
                        control={form.control}
                        name={`deliveryCharges.${index}.areaName`}
                        render={({ field }) => (
                          <FormItem className="min-w-0 grow md:order-1">
                            <FormControl>
                              <Input
                                aria-label={t('delivery.area')}
                                maxLength={DELIVERY_AREA_NAME_MAX_LENGTH}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-ink-muted md:order-4"
                        aria-label={t('delivery.remove', { area: areaLabel(index) })}
                        title={t('delivery.remove', { area: areaLabel(index) })}
                        onClick={() => remove(index)}
                      >
                        <Trash2 aria-hidden strokeWidth={1.5} />
                      </Button>
                    </div>
                    <div className="flex min-w-0 gap-2 md:contents">
                      <FormField
                        control={form.control}
                        name={`deliveryCharges.${index}.charge`}
                        render={({ field }) => (
                          <FormItem className="min-w-0 flex-1 md:order-2">
                            <FormLabel className="text-small text-ink-muted md:sr-only">
                              {t('delivery.charge', { symbol })}
                            </FormLabel>
                            <FormControl>
                              <MoneyInput
                                aria-label={t('delivery.chargeFor', { area: areaLabel(index) })}
                                value={field.value}
                                onChange={field.onChange}
                                onBlur={field.onBlur}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`deliveryCharges.${index}.deliveryTime`}
                        render={({ field }) => (
                          <FormItem className="min-w-0 flex-1 md:order-3">
                            <FormLabel className="text-small text-ink-muted md:sr-only">
                              {t('delivery.time')}
                            </FormLabel>
                            <FormControl>
                              <Input
                                aria-label={t('delivery.timeFor', { area: areaLabel(index) })}
                                placeholder={t('delivery.timePlaceholder')}
                                maxLength={DELIVERY_TIME_MAX_LENGTH}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </li>
                ))}

                <li
                  className={cn(
                    'flex flex-col gap-2 rounded-md bg-surface-sunken p-3 md:items-center',
                    rowGrid,
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body font-medium">{t('delivery.elsewhere')}</span>
                    <span className="text-small text-ink-muted">{t('delivery.elsewhereHint')}</span>
                  </span>
                  <div className="flex min-w-0 gap-2 md:contents">
                    <FormField
                      control={form.control}
                      name="everywhereElse.charge"
                      render={({ field }) => (
                        <FormItem className="min-w-0 flex-1">
                          <FormLabel className="text-small text-ink-muted md:sr-only">
                            {t('delivery.charge', { symbol })}
                          </FormLabel>
                          <FormControl>
                            <MoneyInput
                              aria-label={t('delivery.chargeFor', {
                                area: t('delivery.elsewhereLabel'),
                              })}
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="everywhereElse.deliveryTime"
                      render={({ field }) => (
                        <FormItem className="min-w-0 flex-1">
                          <FormLabel className="text-small text-ink-muted md:sr-only">
                            {t('delivery.time')}
                          </FormLabel>
                          <FormControl>
                            <Input
                              aria-label={t('delivery.timeFor', {
                                area: t('delivery.elsewhereLabel'),
                              })}
                              placeholder={t('delivery.timePlaceholder')}
                              maxLength={DELIVERY_TIME_MAX_LENGTH}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </li>
              </ul>

              <Button
                type="button"
                className="self-start border-accent text-accent"
                onClick={() =>
                  append(
                    { areaName: '', charge: Number.NaN, deliveryTime: '' },
                    { shouldFocus: true },
                  )
                }
              >
                <Plus aria-hidden strokeWidth={1.5} />
                {t('delivery.add')}
              </Button>
              <p className="text-small text-ink-muted">{t('delivery.hint')}</p>
            </div>

            <FormField
              control={form.control}
              name="freeDeliveryOver"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('delivery.freeOver')}</FormLabel>
                  <FormControl>
                    <MoneyInput
                      nullable
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  <FormDescription>{t('delivery.freeOverHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <SaveBar
            dirty={form.formState.isDirty}
            pending={save.isPending}
            onCancel={() => {
              form.reset();
              save.reset();
            }}
          />
        </form>
      </Form>
    </section>
  );
}
