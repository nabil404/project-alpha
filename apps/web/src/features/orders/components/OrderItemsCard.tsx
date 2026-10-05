import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useForm, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { orderItemsEditable, replaceOrderItemsSchema, type OrderDetail } from '@app/shared';

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
import { Form } from '@/components/ui/form';
import { useErrorMessages } from '@/i18n/error-keys';
import { useZodResolver } from '@/lib/form';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';

import { variantDisplayName } from '../format';
import { useReplaceOrderItems } from '../queries';
import { ItemsEditor, type ItemsFormValues, type LineInfo } from './ItemsEditor';
import { useAreaLabel } from './AreaField';

/** The lines, as a table from `sm` up and a stack below it, then the totals. */
export function OrderItemsCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const areaLabel = useAreaLabel();
  const { formatAmount, formatMoney, currencySymbol, formatNumber } = useFormatters();
  const money = (amount: number) => formatMoney(amount, order.currency);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-baseline justify-between gap-4 px-4 pt-4 pb-3 sm:px-6">
        <h2 className="text-heading">{t('items.title')}</h2>
        {/* Lines from before the catalog link was kept can't be re-saved, so they lock the list. */}
        {orderItemsEditable(order.status) && order.items.every((item) => item.variantId) && (
          <EditItemsDialog order={order} />
        )}
      </div>

      <ul className="sm:hidden">
        {order.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 border-t border-border px-4 py-3">
            <ProductName item={item} />
            <span className="flex justify-between gap-2 text-small text-ink-muted tabular-nums">
              <span>
                {t('items.priceTimesQuantity', {
                  price: money(item.unitPrice),
                  quantity: formatNumber(item.quantity),
                })}
              </span>
              <span className="text-body font-medium text-ink">{money(item.lineTotal)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-sunken text-left text-label whitespace-nowrap text-ink-muted">
              <th scope="col" className="border-t border-border py-3 pr-4 pl-6">
                {t('items.columns.product')}
              </th>
              <th scope="col" className="border-t border-border px-4 py-3 text-right">
                {t('items.columns.price', { symbol: currencySymbol(order.currency) })}
              </th>
              <th scope="col" className="border-t border-border px-4 py-3 text-right">
                {t('items.columns.quantity')}
              </th>
              <th scope="col" className="border-t border-border py-3 pr-6 pl-4 text-right">
                {t('items.columns.total', { symbol: currencySymbol(order.currency) })}
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-t border-border">
                <td className="py-3 pr-4 pl-6">
                  <ProductName item={item} />
                </td>
                <td className="px-4 py-3 text-right text-body tabular-nums">
                  {formatAmount(item.unitPrice, order.currency)}
                </td>
                <td className="px-4 py-3 text-right text-body tabular-nums">
                  {t('items.times', { quantity: formatNumber(item.quantity) })}
                </td>
                <td className="py-3 pr-6 pl-4 text-right text-body font-medium tabular-nums">
                  {formatAmount(item.lineTotal, order.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="flex flex-col gap-2 border-t border-border px-4 py-4 text-body sm:px-6">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">{t('totals.subtotal')}</dt>
          <dd className="tabular-nums">{money(order.subtotal)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">
            {areaLabel(order.delivery)
              ? t('totals.deliveryInArea', { area: areaLabel(order.delivery) })
              : t('totals.delivery')}
          </dt>
          <dd className="tabular-nums">{money(order.deliveryFee)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-2 text-heading">
          <dt>{t('totals.total')}</dt>
          <dd className="tabular-nums">{money(order.total)}</dd>
        </div>
      </dl>
    </section>
  );
}

function ProductName({ item }: { item: OrderDetail['items'][number] }) {
  const name = item.productId ? (
    <Link
      to="/catalog/products/$productId"
      params={{ productId: item.productId }}
      className="text-body font-medium text-ink underline-offset-4 hover:text-link hover:underline"
    >
      {item.productName}
    </Link>
  ) : (
    <span className="text-body font-medium">{item.productName}</span>
  );
  const detail = [item.variantName, item.sku].filter(Boolean).join(' · ');

  return (
    <span className="flex min-w-0 flex-col">
      {name}
      {detail && <span className="text-small text-ink-muted">{detail}</span>}
    </span>
  );
}

const itemsFormSchema = replaceOrderItemsSchema.pick({ items: true });

const toFormValues = (order: OrderDetail): ItemsFormValues => ({
  items: order.items.flatMap((item) =>
    item.variantId
      ? [{ variantId: item.variantId, quantity: item.quantity, unitPrice: item.unitPrice }]
      : [],
  ),
});

const toInfo = (order: OrderDetail) =>
  new Map<string, LineInfo>(
    order.items.flatMap((item) =>
      item.variantId
        ? [
            [
              item.variantId,
              { label: variantDisplayName(item.productName, item.variantName), sku: item.sku },
            ],
          ]
        : [],
    ),
  );

/**
 * Replaces the lines. A confirmed order's stock follows the change; a line
 * already on the order keeps the name, SKU and price it was ordered at unless
 * the seller changes the price here.
 */
function EditItemsDialog({ order }: { order: OrderDetail }) {
  const { t } = useTranslation(['orders', 'common']);
  const { forError } = useErrorMessages();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(() => toInfo(order));
  const replace = useReplaceOrderItems(order.id);

  const form = useForm<ItemsFormValues>({
    resolver: useZodResolver(itemsFormSchema) as unknown as Resolver<ItemsFormValues>,
    defaultValues: toFormValues(order),
  });

  const onOpenChange = (next: boolean) => {
    if (!next && replace.isPending) return;
    setOpen(next);
    // Opening starts from the order as it is now, not from an earlier, cancelled edit.
    form.reset(toFormValues(order));
    setInfo(toInfo(order));
    replace.reset();
  };

  const onSubmit = (values: ItemsFormValues) =>
    replace.mutate(
      { items: values.items, version: order.version },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(t('items.saved'));
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="link" className="text-small">
          {t('items.edit')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('items.dialog.title')}</DialogTitle>
          <DialogDescription>
            {order.status === 'confirmed'
              ? t('items.dialog.descriptionConfirmed')
              : t('items.dialog.description')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
            {replace.isError && <ErrorBanner>{forError(replace.error)}</ErrorBanner>}
            <ItemsEditor
              form={form}
              info={info}
              onAddInfo={(variantId, line) => setInfo((prev) => new Map(prev).set(variantId, line))}
              currency={order.currency}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" disabled={replace.isPending}>
                  {t('common:actions.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={replace.isPending}>
                {t('common:actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
