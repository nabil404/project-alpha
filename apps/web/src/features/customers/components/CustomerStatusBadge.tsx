import type { CustomerStatus } from '@app/shared';

import { useStatusLabels } from '@/i18n/status-keys';
import { customerStatusTones, statusToneClasses } from '@/i18n/status-tones';
import { cn } from '@/lib/utils';

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  const { customerStatus } = useStatusLabels();

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-label whitespace-nowrap',
        statusToneClasses[customerStatusTones[status]],
      )}
    >
      {customerStatus(status)}
    </span>
  );
}
