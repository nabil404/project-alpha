import type { ImportRunStatus } from '@app/shared';

import { useStatusLabels } from '@/i18n/status-keys';
import { importRunStatusTones, statusToneClasses } from '@/i18n/status-tones';
import { cn } from '@/lib/utils';

export function ImportRunBadge({ status }: { status: ImportRunStatus }) {
  const { importRunStatus } = useStatusLabels();

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-label whitespace-nowrap',
        statusToneClasses[importRunStatusTones[status]],
      )}
    >
      {importRunStatus(status)}
    </span>
  );
}
