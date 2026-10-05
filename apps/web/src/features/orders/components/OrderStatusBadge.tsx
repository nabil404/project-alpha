import type { OrderStatus } from '@app/shared';

import { useStatusLabels } from '@/i18n/status-keys';
import { orderStatusTones, statusToneClasses } from '@/i18n/status-tones';
import { cn } from '@/lib/utils';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { orderStatus } = useStatusLabels();

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-label whitespace-nowrap',
        statusToneClasses[orderStatusTones[status]],
      )}
    >
      {orderStatus(status)}
    </span>
  );
}
