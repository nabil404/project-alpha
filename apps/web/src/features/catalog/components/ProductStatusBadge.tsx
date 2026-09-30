import type { ProductStatus } from '@app/shared';

import { useStatusLabels } from '@/i18n/status-keys';
import { productStatusTones, statusToneClasses } from '@/i18n/status-tones';
import { cn } from '@/lib/utils';

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const { productStatus } = useStatusLabels();

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-label whitespace-nowrap',
        statusToneClasses[productStatusTones[status]],
      )}
    >
      {productStatus(status)}
    </span>
  );
}
