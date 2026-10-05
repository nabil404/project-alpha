import { useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useForm, type Resolver, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  createOrderSchema,
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_NAME_MAX_LENGTH,
  ORDER_NOTE_MAX_LENGTH,
  ORDER_AREA_MAX_LENGTH,
  paymentMethods,
  type CreateOrder,
  type CustomerDetail,
  type CustomerListItem,
  type PaymentMethod,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { SearchInput } from '@/components/SearchInput';
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
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from '@/features/catalog';
import { CustomerAvatar, useCustomerName } from '@/features/conversations';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';
import { useShopRegion } from '@/lib/shop-region';
import { useToast } from '@/lib/toast';

import { useCreateOrder, useCustomerSearch, useOrderCustomer } from '../queries';
import { ItemsEditor, type EditableLine, type ItemsFormValues, type LineInfo } from './ItemsEditor';

/**
 * An order the seller enters by hand, for someone who has messaged the Page:
 * pick the customer, then the items and delivery. It starts as drafted, like
 * one the assistant takes, and opens on its own page to be confirmed.
 */
export function CreateOrderDialog({ trigger }: { trigger: ReactNode }) {
  const { t } = useTranslation('orders');
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerListItem | null>(null);
  // One key per dialog: a retry after a lost answer returns the order already made.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  const onOpenChange = (next: boolean) => {
    if (!next && busy) return;
    setOpen(next);
    if (next) {
      setCustomer(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>
        {customer ? (
          <ChosenCustomer
            key={customer.id}
            customer={customer}
            idempotencyKey={idempotencyKey}
            onChange={() => setCustomer(null)}
            onBusyChange={setBusy}
            onDone={() => setOpen(false)}
          />
        ) : (
          <CustomerPicker onPick={setCustomer} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomerPicker({ onPick }: { onPick: (customer: CustomerListItem) => void }) {
  const { t } = useTranslation(['orders', 'common']);
  const customerName = useCustomerName();
  const [q, setQ] = useState<string | undefined>();
  const customers = useCustomerSearch(q ?? '');

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        value={q}
        onChange={setQ}
        label={t('create.customerSearchLabel')}
        placeholder={t('create.customerSearchPlaceholder')}
      />
      {customers.isPending ? (
        <span aria-hidden className="h-40 animate-pulse rounded-md bg-surface-sunken" />
      ) : customers.isError || customers.data.data.length === 0 ? (
        <p className="text-small text-ink-muted">
          {customers.isError ? t('create.customerSearchFailed') : t('create.noCustomers')}
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col overflow-y-auto">
          {customers.data.data.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => onPick(customer)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover"
              >
                <CustomerAvatar
                  name={customer.name}
                  pictureUrl={customer.pictureUrl}
                  className="size-9"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body font-medium">
                    {customerName(customer.name)}
                  </span>
                  <span className="truncate text-small text-ink-muted">
                    {[customer.phone, customer.area].filter(Boolean).join(' · ') ||
                      t('create.noContact')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button">{t('common:actions.cancel')}</Button>
        </DialogClose>
      </DialogFooter>
    </div>
  );
}

/** The new order's form, once the customer's details on file have loaded to start it from. */
function ChosenCustomer({
  customer,
  idempotencyKey,
  onChange,
  onBusyChange,
  onDone,
}: {
  customer: CustomerListItem;
  idempotencyKey: string;
  onChange: () => void;
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['orders', 'common']);
  const { forError } = useErrorMessages();
  const customerName = useCustomerName();
  const detail = useOrderCustomer(customer.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 rounded-md bg-surface-sunken px-3 py-2">
        <CustomerAvatar name={customer.name} pictureUrl={customer.pictureUrl} className="size-9" />
        <span className="min-w-0 grow truncate text-body font-medium">
          {customerName(customer.name)}
        </span>
        <Button type="button" variant="link" className="text-small" onClick={onChange}>
          {t('create.changeCustomer')}
        </Button>
      </div>
      {detail.isError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorBanner className="self-stretch">{forError(detail.error)}</ErrorBanner>
          <Button size="sm" onClick={() => void detail.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : detail.isPending ? (
        <span aria-hidden className="h-64 animate-pulse rounded-md bg-surface-sunken" />
      ) : (
        <NewOrderForm
          customer={detail.data}
          idempotencyKey={idempotencyKey}
          onBusyChange={onBusyChange}
          onDone={onDone}
        />
      )}
    </div>
  );
}

const formSchema = createOrderSchema
  .omit({ customerId: true })
  .required({ customerName: true, phone: true, deliveryAddress: true });

/** Every text field is a string in the form; the schema turns blanks into absent values. */
interface NewOrderFormValues {
  items: EditableLine[];
  customerName: string;
  phone: string;
  deliveryAddress: string;
  deliveryArea: string;
  deliveryFee: number;
  paymentMethod: PaymentMethod;
  note: string;
}
type NewOrderInput = Omit<CreateOrder, 'customerId'>;

const serverFields = [
  'items',
  'customerName',
  'phone',
  'deliveryAddress',
  'deliveryArea',
  'deliveryFee',
  'note',
] as const;

function NewOrderForm({
  customer,
  idempotencyKey,
  onBusyChange,
  onDone,
}: {
  customer: CustomerDetail;
  idempotencyKey: string;
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['orders', 'common']);
  const { forError, forField } = useErrorMessages();
  const { paymentMethod } = useStatusLabels();
  const { currency } = useShopRegion();
  const toast = useToast();
  const navigate = useNavigate();
  const create = useCreateOrder();
  const [info, setInfo] = useState(() => new Map<string, LineInfo>());

  const form = useForm<NewOrderFormValues, unknown, NewOrderInput>({
    // The schema's input is `unknown` per preprocessed field, and resolver
    // types are invariant in their input, hence the cast.
    resolver: useZodResolver(formSchema) as unknown as Resolver<
      NewOrderFormValues,
      unknown,
      NewOrderInput
    >,
    defaultValues: {
      items: [],
      customerName: customer.name ?? '',
      phone: customer.phone ?? '',
      deliveryAddress: customer.deliveryAddress ?? '',
      deliveryArea: '',
      deliveryFee: 0,
      paymentMethod: 'cash_on_delivery',
      note: '',
    },
  });

  const onSubmit = (values: NewOrderInput) => {
    onBusyChange(true);
    create.mutate(
      { input: { ...values, customerId: customer.id }, idempotencyKey },
      {
        onSuccess: (order) => {
          onDone();
          toast.success(t('create.done'));
          void navigate({ to: '/orders/$orderId', params: { orderId: order.id } });
        },
        onError: (error) => {
          if (applyServerFieldErrors(error, form.setError, serverFields, forField)) create.reset();
        },
        onSettled: () => onBusyChange(false),
      },
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        {create.isError && <ErrorBanner>{forError(create.error)}</ErrorBanner>}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-heading">{t('create.itemsTitle')}</legend>
          <ItemsEditor
            // The editor only reads and writes `items`, which this form keeps at the same path.
            form={form as unknown as UseFormReturn<ItemsFormValues>}
            info={info}
            onAddInfo={(variantId, line) => setInfo((prev) => new Map(prev).set(variantId, line))}
            currency={currency}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-heading">{t('create.deliveryTitle')}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <FormField
            control={form.control}
            name="deliveryAddress"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('delivery.address')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} maxLength={ORDER_ADDRESS_MAX_LENGTH} {...field} />
                </FormControl>
                <FormDescription>{t('create.detailsHint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="deliveryArea"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('delivery.area')}</FormLabel>
                  <FormControl>
                    <Input maxLength={ORDER_AREA_MAX_LENGTH} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('payment.method')}</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {paymentMethods.map((option) => (
                        <option key={option} value={option}>
                          {paymentMethod(option)}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('note.title')}</FormLabel>
                <FormControl>
                  <Textarea rows={2} maxLength={ORDER_NOTE_MAX_LENGTH} {...field} />
                </FormControl>
                <FormDescription>{t('note.hint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </fieldset>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" disabled={create.isPending}>
              {t('common:actions.cancel')}
            </Button>
          </DialogClose>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {t('create.submit')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
