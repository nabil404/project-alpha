import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  paymentMethods,
  paymentStatuses,
  type OrderDetail,
  type PaymentMethod,
  type PaymentStatus,
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
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { paymentStatusTones, statusToneClasses } from '@/i18n/status-tones';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { useUpdateOrder } from '../queries';

/**
 * How the customer pays, as the seller records it: the MVP takes no payments
 * itself, so "paid" is the seller's word for it.
 */
export function PaymentCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const { paymentStatus, paymentMethod } = useStatusLabels();
  const { formatMoney } = useFormatters();
  const toast = useToast();
  const update = useUpdateOrder(order.id);
  const total = formatMoney(order.total, order.currency);

  const hint =
    order.paymentStatus === 'paid'
      ? t('payment.hint.paid', { total })
      : order.paymentStatus === 'refunded'
        ? t('payment.hint.refunded', { total })
        : t(`payment.hint.unpaid.${order.paymentMethod}`, { total });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-heading">{t('payment.title')}</h2>
        <EditPaymentDialog order={order} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="text-body font-medium">{paymentMethod(order.paymentMethod)}</span>
            <span
              className={cn(
                'inline-flex h-6 items-center rounded-full px-2.5 text-label',
                statusToneClasses[paymentStatusTones[order.paymentStatus]],
              )}
            >
              {paymentStatus(order.paymentStatus)}
            </span>
          </span>
          <span className="text-small text-ink-muted">{hint}</span>
        </div>
        {order.paymentStatus === 'unpaid' && order.status !== 'cancelled' && (
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { paymentStatus: 'paid', version: order.version },
                {
                  onSuccess: () => toast.success(t('payment.markedPaid')),
                  onError: (error) => toast.error(error),
                },
              )
            }
          >
            {t('payment.markPaid')}
          </Button>
        )}
      </div>
    </section>
  );
}

function EditPaymentDialog({ order }: { order: OrderDetail }) {
  const { t } = useTranslation(['orders', 'common']);
  const { paymentStatus, paymentMethod } = useStatusLabels();
  const { forError } = useErrorMessages();
  const toast = useToast();
  const update = useUpdateOrder(order.id);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>(order.paymentStatus);
  const [method, setMethod] = useState<PaymentMethod>(order.paymentMethod);

  const onOpenChange = (next: boolean) => {
    if (!next && update.isPending) return;
    setOpen(next);
    setStatus(order.paymentStatus);
    setMethod(order.paymentMethod);
    update.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="link" className="text-small">
          {t('payment.edit')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payment.dialog.title')}</DialogTitle>
          <DialogDescription>{t('payment.dialog.description')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(
              { paymentStatus: status, paymentMethod: method, version: order.version },
              {
                onSuccess: () => {
                  setOpen(false);
                  toast.success(t('payment.saved'));
                },
              },
            );
          }}
        >
          {update.isError && <ErrorBanner>{forError(update.error)}</ErrorBanner>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="payment-method">{t('payment.method')}</Label>
            <NativeSelect
              id="payment-method"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {paymentMethods.map((option) => (
                <option key={option} value={option}>
                  {paymentMethod(option)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="payment-status">{t('payment.status')}</Label>
            <NativeSelect
              id="payment-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as PaymentStatus)}
            >
              {paymentStatuses.map((option) => (
                <option key={option} value={option}>
                  {paymentStatus(option)}
                </option>
              ))}
            </NativeSelect>
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
      </DialogContent>
    </Dialog>
  );
}
