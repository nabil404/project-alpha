import { useState, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MapPin, MessageCircle, Navigation, Phone } from 'lucide-react';
import {
  CUSTOMER_ADDRESS_MAX_LENGTH,
  CUSTOMER_AREA_MAX_LENGTH,
  updateCustomerSchema,
  type CustomerDetail,
  type UpdateCustomer,
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
import { Textarea } from '@/components/ui/textarea';
import { useCustomerName } from '@/features/conversations';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';
import { useToast } from '@/lib/toast';

import { useUpdateCustomer } from '../queries';

/**
 * What the seller keeps about the customer. The name is Facebook's, shown as
 * "Messenger" and never edited; the rest is the seller's own record, which an
 * order snapshots when it is placed.
 */
export function ContactCard({ customer }: { customer: CustomerDetail }) {
  const { t } = useTranslation('customers');
  const customerName = useCustomerName();

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-heading">{t('contact.title')}</h2>
        <EditContactDialog customer={customer} />
      </div>
      <ContactLine icon={<Phone />} label={t('contact.phone')} value={customer.phone} />
      <ContactLine
        icon={<MapPin />}
        label={t('contact.deliveryAddress')}
        value={customer.deliveryAddress}
      />
      <ContactLine icon={<Navigation />} label={t('contact.area')} value={customer.area} />
      <ContactLine
        icon={<MessageCircle />}
        label={t('contact.messenger')}
        value={customerName(customer.name)}
      />
    </section>
  );
}

function ContactLine({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
}) {
  const { t } = useTranslation('customers');

  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="flex pt-1 text-ink-muted [&_svg]:size-4 [&_svg]:stroke-[1.5]">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-small text-ink-muted">{label}</span>
        {value ? (
          <span className="text-body break-words whitespace-pre-line">{value}</span>
        ) : (
          <span className="text-body text-ink-muted">{t('contact.notAdded')}</span>
        )}
      </span>
    </div>
  );
}

/** Every field is a string in the form; the schema turns a blank one into a clear. */
interface ContactFormValues {
  phone: string;
  deliveryAddress: string;
  area: string;
}

const serverFields = ['phone', 'deliveryAddress', 'area'] as const;

const toFormValues = (customer: CustomerDetail): ContactFormValues => ({
  phone: customer.phone ?? '',
  deliveryAddress: customer.deliveryAddress ?? '',
  area: customer.area ?? '',
});

function EditContactDialog({ customer }: { customer: CustomerDetail }) {
  const { t } = useTranslation(['customers', 'common']);
  const { forError, forField } = useErrorMessages();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const update = useUpdateCustomer(customer.id);

  const form = useForm<ContactFormValues, unknown, UpdateCustomer>({
    // The schema's input is `unknown` per field (it preprocesses blanks), and
    // resolver types are invariant in their input, hence the cast.
    resolver: useZodResolver(updateCustomerSchema) as unknown as Resolver<
      ContactFormValues,
      unknown,
      UpdateCustomer
    >,
    defaultValues: toFormValues(customer),
  });

  const onOpenChange = (next: boolean) => {
    if (!next && update.isPending) return;
    setOpen(next);
    // Opening starts from what is saved now, not from an earlier, cancelled edit.
    form.reset(toFormValues(customer));
    update.reset();
  };

  const onSubmit = (values: UpdateCustomer) =>
    update.mutate(values, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t('contact.saved'));
      },
      onError: (error) => {
        if (applyServerFieldErrors(error, form.setError, serverFields, forField)) update.reset();
      },
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="link" className="text-small">
          {t('contact.edit')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('contact.dialog.title')}</DialogTitle>
          <DialogDescription>{t('contact.dialog.description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
            {update.isError && <ErrorBanner>{forError(update.error)}</ErrorBanner>}
            <div className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('contact.phone')}</FormLabel>
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
                    <FormLabel>{t('contact.deliveryAddress')}</FormLabel>
                    <FormControl>
                      <Textarea rows={3} maxLength={CUSTOMER_ADDRESS_MAX_LENGTH} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="area"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('contact.area')}</FormLabel>
                    <FormControl>
                      <Input maxLength={CUSTOMER_AREA_MAX_LENGTH} {...field} />
                    </FormControl>
                    <FormDescription>{t('contact.dialog.areaHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
