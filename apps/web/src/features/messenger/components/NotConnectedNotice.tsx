import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Above the connect card while the shop has no Page: nothing reaches the assistant yet. */
export function NotConnectedNotice() {
  const { t } = useTranslation('settings');

  return (
    <div role="status" className="flex items-start gap-3 rounded-lg bg-warning-soft px-4 py-3">
      <TriangleAlert
        aria-hidden
        className="mt-0.5 size-5 shrink-0 text-warning"
        strokeWidth={1.5}
      />
      <p className="text-body">
        <strong className="font-semibold">{t('messenger.notConnected.title')}</strong>{' '}
        {t('messenger.notConnected.body')}
      </p>
    </div>
  );
}
