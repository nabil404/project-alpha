import { useState } from 'react';
import { Ban, Check, PackageCheck, RotateCcw, Truck, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  canTransitionOrder,
  ORDER_NOTE_MAX_LENGTH,
  orderStatuses,
  type OrderDetail,
  type OrderStatus,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessages } from '@/i18n/error-keys';
import { useToast } from '@/lib/toast';

import { useChangeOrderStatus } from '../queries';

/** The moves forward, one button each; leaving the lifecycle asks first. */
const forward = {
  confirmed: Check,
  packed: PackageCheck,
  shipped: Truck,
  delivered: Check,
} as const satisfies Partial<Record<OrderStatus, LucideIcon>>;
type ForwardStatus = keyof typeof forward;
const isForward = (status: OrderStatus): status is ForwardStatus => status in forward;

/** Cancelling and returning give stock back, so the seller confirms them and may say why. */
type ExitStatus = Extract<OrderStatus, 'cancelled' | 'returned'>;

/**
 * The order's next steps, as the shared lifecycle allows them from where it
 * is: the step forward as the primary button, and cancelling or returning
 * behind a confirmation. A finished order has none.
 */
export function OrderActions({ order }: { order: OrderDetail }) {
  const { t } = useTranslation('orders');
  const toast = useToast();
  const change = useChangeOrderStatus(order.id);
  const next = orderStatuses.filter((status) => canTransitionOrder(order.status, status));
  const step = next.find(isForward);

  if (next.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 max-sm:w-full">
      {canTransitionOrder(order.status, 'returned') && (
        <ExitButton order={order} status="returned" icon={RotateCcw} />
      )}
      {canTransitionOrder(order.status, 'cancelled') && (
        <ExitButton order={order} status="cancelled" icon={Ban} />
      )}
      {step && (
        <Button
          variant="primary"
          className="max-sm:grow"
          disabled={change.isPending}
          onClick={() =>
            change.mutate(
              { status: step, version: order.version },
              {
                onSuccess: () => toast.success(t(`actions.${step}.done`)),
                onError: (error) => toast.error(error),
              },
            )
          }
        >
          <ForwardIcon status={step} />
          {t(`actions.${step}.label`)}
        </Button>
      )}
    </div>
  );
}

function ForwardIcon({ status }: { status: ForwardStatus }) {
  const Icon = forward[status];
  return <Icon aria-hidden strokeWidth={1.5} />;
}

function ExitButton({
  order,
  status,
  icon: Icon,
}: {
  order: OrderDetail;
  status: ExitStatus;
  icon: LucideIcon;
}) {
  const { t } = useTranslation(['orders', 'common']);
  const { forError } = useErrorMessages();
  const toast = useToast();
  const change = useChangeOrderStatus(order.id);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const givesStockBack = order.status !== 'new';

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Not while the request is out: closing would hide its outcome.
        if (change.isPending) return;
        setOpen(next);
        if (!next) {
          change.reset();
          setNote('');
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant={status === 'cancelled' ? 'danger' : 'secondary'} className="max-sm:grow">
          <Icon aria-hidden strokeWidth={1.5} />
          {t(`actions.${status}.label`)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`actions.${status}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>
            {givesStockBack
              ? t(`actions.${status}.descriptionStock`)
              : t(`actions.${status}.description`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {change.isError && <ErrorBanner>{forError(change.error)}</ErrorBanner>}
        <div className="flex flex-col gap-2">
          <Label htmlFor={`order-${status}-note`}>{t('actions.reason')}</Label>
          <Textarea
            id={`order-${status}-note`}
            rows={3}
            maxLength={ORDER_NOTE_MAX_LENGTH}
            placeholder={t('actions.reasonPlaceholder')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={change.isPending}>{t('actions.keep')}</AlertDialogCancel>
          {/* A plain button, not AlertDialogAction: that one closes the dialog before the request answers. */}
          <Button
            type="button"
            variant={status === 'cancelled' ? 'danger' : 'primary'}
            disabled={change.isPending}
            onClick={() =>
              change.mutate(
                { status, version: order.version, note: note.trim() || undefined },
                {
                  onSuccess: () => {
                    setOpen(false);
                    setNote('');
                    toast.success(t(`actions.${status}.done`));
                  },
                },
              )
            }
          >
            {t(`actions.${status}.confirm`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
