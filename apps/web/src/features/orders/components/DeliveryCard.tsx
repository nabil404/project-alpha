import { useState, type ReactNode } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Banknote, Clock, MapPin, Navigation, Phone, User } from 'lucide-react';
import {
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_NAME_MAX_LENGTH,
  ORDER_TRACKING_MAX_LENGTH,
  ORDER_AREA_MAX_LENGTH,
  orderDeliveryEditable,
  updateOrderSchema,
  type OrderDetail,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from '@/features/catalog';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';

import { useUpdateOrder } from '../queries';
import {
  AreaSelect,
  useAreaLabel,
  useDeliveryRates,
  useQuotedFee,
  type AreaPick,
} from './AreaField';

/** The tracking number means something once the parcel is ready to go. */
const TRACKING_FROM = new Set<OrderDetail['status']>([
  'packed',
  'shipped',
  'delivered',
  'returned',
]);

/**
 * Where the order goes: the order's own copy of the customer's details,
 * which editing here never writes back to the customer. They change until
 * the order ships; the tracking number from when it is packed.
 */
export function DeliveryCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const { formatMoney } = useFormatters();
  const areaLabel = useAreaLabel();

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-heading">{t('delivery.title')}</h2>
        {orderDeliveryEditable(order.status) && <EditDeliveryDialog order={order} />}
      </div>
      <DetailLine icon={<User />} label={t('delivery.name')} value={order.delivery.name} />
      <DetailLine icon={<Phone />} label={t('delivery.phone')} value={order.delivery.phone} />
      <DetailLine icon={<MapPin />} label={t('delivery.address')} value={order.delivery.address} />
      <DetailLine
        icon={<Navigation />}
        label={t('delivery.area')}
        value={areaLabel(order.delivery) ?? t('delivery.noArea')}
      />
      <DetailLine
        icon={<Banknote />}
        label={t('delivery.fee')}
        value={formatMoney(order.deliveryFee, order.currency)}
      />
      {order.delivery.time && (
        <DetailLine
          icon={<Clock />}
          label={t('delivery.time')}
          value={t('delivery.estimate', { time: order.delivery.time })}
        />
      )}
      <TrackingField order={order} />
    </section>
  );
}

function DetailLine({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="flex pt-1 text-ink-muted [&_svg]:size-4 [&_svg]:stroke-[1.5]">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-small text-ink-muted">{label}</span>
        <span className="text-body break-words whitespace-pre-line">{value}</span>
      </span>
    </div>
  );
}

function TrackingField({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const { forError } = useErrorMessages();
  const toast = useToast();
  const update = useUpdateOrder(order.id);
  const saved = order.trackingNumber ?? '';
  const [draft, setDraft] = useState(saved);
  const [shownFor, setShownFor] = useState(saved);
  const enabled = TRACKING_FROM.has(order.status);

  // A save, or someone else's, puts a new number in from outside: show it.
  if (shownFor !== saved) {
    setShownFor(saved);
    setDraft(saved);
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-2 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          { trackingNumber: draft, version: order.version },
          { onSuccess: () => toast.success(t('delivery.trackingSaved')) },
        );
      }}
    >
      <Label htmlFor="order-tracking">{t('delivery.tracking')}</Label>
      {update.isError && <ErrorBanner>{forError(update.error)}</ErrorBanner>}
      <div className="flex gap-2">
        <Input
          id="order-tracking"
          disabled={!enabled}
          maxLength={ORDER_TRACKING_MAX_LENGTH}
          placeholder={enabled ? undefined : t('delivery.trackingLater')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {enabled && draft.trim() !== saved && (
          <Button type="submit" disabled={update.isPending}>
            {t('delivery.saveTracking')}
          </Button>
        )}
      </div>
    </form>
  );
}

const deliveryFormSchema = updateOrderSchema
  .pick({
    customerName: true,
    phone: true,
    deliveryAddress: true,
    deliveryArea: true,
    deliveryChargeId: true,
    deliveryFee: true,
  })
  .required({ customerName: true, phone: true, deliveryAddress: true, deliveryFee: true });

/** Every text field is a string in the form; the schema turns a blank area into a clear. */
interface DeliveryFormValues {
  customerName: string;
  phone: string;
  deliveryAddress: string;
  deliveryArea: string;
  deliveryChargeId: string | null;
  deliveryFee: number;
}
type DeliveryChanges = Omit<typeof updateOrderSchema._output, 'version'>;

const serverFields = [
  'customerName',
  'phone',
  'deliveryAddress',
  'deliveryArea',
  'deliveryChargeId',
  'deliveryFee',
] as const;

const toFormValues = (order: OrderDetail): DeliveryFormValues => ({
  customerName: order.delivery.name,
  phone: order.delivery.phone,
  deliveryAddress: order.delivery.address,
  deliveryArea: order.delivery.area ?? '',
  deliveryChargeId: order.delivery.chargeId,
  deliveryFee: order.deliveryFee,
});

function EditDeliveryDialog({ order }: { order: OrderDetail }) {
  const { t } = useTranslation(['orders', 'common']);
  const { forError, forField } = useErrorMessages();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const update = useUpdateOrder(order.id);

  const form = useForm<DeliveryFormValues, unknown, DeliveryChanges>({
    // The schema's input is `unknown` per preprocessed field, and resolver
    // types are invariant in their input, hence the cast.
    resolver: useZodResolver(deliveryFormSchema) as unknown as Resolver<
      DeliveryFormValues,
      unknown,
      DeliveryChanges
    >,
    defaultValues: toFormValues(order),
  });

  const rates = useDeliveryRates();
  const [area, chargeId, fee] = useWatch({
    control: form.control,
    name: ['deliveryArea', 'deliveryChargeId', 'deliveryFee'],
  });
  const lines = order.items.flatMap((line) =>
    line.variantId
      ? [{ variantId: line.variantId, quantity: line.quantity, unitPrice: line.unitPrice }]
      : [],
  );
  const { freeApplied, requote } = useQuotedFee({
    chargeId,
    items: lines,
    fee,
    setFee: (next) => form.setValue('deliveryFee', next, { shouldDirty: true }),
  });
  const onPickArea = (pick: AreaPick) => {
    form.setValue('deliveryChargeId', pick.chargeId, { shouldDirty: true });
    form.setValue('deliveryArea', pick.area, { shouldDirty: true });
    requote(pick.chargeId);
  };

  const onOpenChange = (next: boolean) => {
    if (!next && update.isPending) return;
    setOpen(next);
    // Opening starts from the order as it is now, not from an earlier, cancelled edit.
    form.reset(toFormValues(order));
    update.reset();
  };

  const onSubmit = (values: DeliveryChanges) =>
    update.mutate(
      { ...values, version: order.version },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(t('delivery.saved'));
        },
        onError: (error) => {
          if (applyServerFieldErrors(error, form.setError, serverFields, forField)) update.reset();
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="link" className="text-small">
          {t('delivery.edit')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('delivery.dialog.title')}</DialogTitle>
          <DialogDescription>{t('delivery.dialog.description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
            {update.isError && <ErrorBanner>{forError(update.error)}</ErrorBanner>}
            <div className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('delivery.name')}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" maxLength={ORDER_NAME_MAX_LENGTH} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('delivery.phone')}</FormLabel>
                    <FormControl>
                      <Input type="tel" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="deliveryAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('delivery.address')}</FormLabel>
                    <FormControl>
                      <Textarea rows={3} maxLength={ORDER_ADDRESS_MAX_LENGTH} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {rates.length > 0 ? (
                  <FormField
                    control={form.control}
                    name="deliveryChargeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('delivery.area')}</FormLabel>
                        <FormControl>
                          <AreaSelect
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            rates={rates}
                            chargeId={field.value}
                            area={area}
                            onPick={onPickArea}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name="deliveryArea"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('delivery.area')}</FormLabel>
                        <FormControl>
                          <Input maxLength={ORDER_AREA_MAX_LENGTH} {...field} />
                        </FormControl>
                        <FormDescription>
                          <Link to="/settings/delivery" className="text-link">
                            {t('delivery.dialog.noAreas')}
                          </Link>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="deliveryFee"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('delivery.fee')}</FormLabel>
                      <FormControl>
                        <MoneyInput
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                        />
                      </FormControl>
                      {freeApplied && field.value === 0 && (
                        <FormDescription>{t('delivery.freeApplied')}</FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" disabled={update.isPending}>
                  {t('common:actions.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={update.isPending}>
                {t('common:actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
