import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import type { NotificationKind, NotificationSettings } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Switch } from '@/components/ui/switch';
import { useErrorMessages } from '@/i18n/error-keys';
import { useToast } from '@/lib/toast';

import { useUpdateNotificationSettings } from '../notification-queries';

interface SwitchRow {
  name: NotificationKind;
  label: ParseKeys<'settings'>;
  hint: ParseKeys<'settings'>;
}

const ROWS: readonly SwitchRow[] = [
  {
    name: 'newOrder',
    label: 'notifications.newOrder.label',
    hint: 'notifications.newOrder.hint',
  },
  {
    name: 'customerWaiting',
    label: 'notifications.customerWaiting.label',
    hint: 'notifications.customerWaiting.hint',
  },
  {
    name: 'dailySummary',
    label: 'notifications.dailySummary.label',
    hint: 'notifications.dailySummary.hint',
  },
];

/** The signed-in person's notification emails for this shop. Each switch saves the moment it flips. */
export function NotificationsCard({ settings }: { settings: NotificationSettings }) {
  const { t } = useTranslation('settings');
  const { forError } = useErrorMessages();
  const toast = useToast();
  const update = useUpdateNotificationSettings();
  const id = useId();
  // Not update.error: the mutation tracks only the latest toggle, so an earlier
  // one failing while a later is in flight would put its switch back unexplained.
  const [error, setError] = useState<unknown>(null);

  const toggle = (name: NotificationKind, on: boolean) => {
    setError(null);
    void update.mutateAsync({ [name]: on }).then(
      () => toast.success(t('notifications.saved')),
      (failure: unknown) => setError(failure),
    );
  };

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('notifications.title')}</h2>
        <p className="text-body text-ink-muted">{t('notifications.description')}</p>
      </div>

      {error != null && <ErrorBanner>{forError(error)}</ErrorBanner>}

      <ul className="flex flex-col divide-y divide-border">
        {ROWS.map(({ name, label, hint }) => (
          <li key={name} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
            <div className="flex grow flex-col gap-0.5">
              <span id={`${id}-${name}-label`} className="text-body font-medium">
                {t(label)}
              </span>
              <span id={`${id}-${name}-hint`} className="text-small text-ink-muted">
                {t(hint)}
              </span>
            </div>
            <Switch
              className="mt-0.5"
              checked={settings[name]}
              onCheckedChange={(on) => toggle(name, on)}
              aria-labelledby={`${id}-${name}-label`}
              aria-describedby={`${id}-${name}-hint`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
