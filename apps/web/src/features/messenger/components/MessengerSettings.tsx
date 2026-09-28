import type { ErrorCode } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { useErrorMessages } from '@/i18n/error-keys';

import { useFacebookPage } from '../queries';
import { ChoosePageCard } from './ChoosePageCard';
import { ConnectedPageCard } from './ConnectedPageCard';
import { ConnectPageCard } from './ConnectPageCard';
import { NotConnectedNotice } from './NotConnectedNotice';

/**
 * Settings > Messenger. Which card shows follows the connection flow:
 * choosing a Page right after Facebook sends the seller back, else the
 * connected Page, else the invitation to connect one.
 */
export function MessengerSettings({
  step,
  error,
  onFlowDone,
}: {
  /** `choose-page` when Facebook just sent the seller back. */
  step?: 'choose-page';
  /** Why Facebook's round trip failed, from the API's callback redirect. */
  error?: ErrorCode;
  /** Clears `step` and `error` from the URL. */
  onFlowDone: () => void;
}) {
  const { forError, forCode } = useErrorMessages();
  const page = useFacebookPage();

  if (page.isPending) {
    return (
      <div aria-busy className="h-64 rounded-lg border border-border bg-surface shadow-card" />
    );
  }
  if (page.isError) {
    return <ErrorBanner>{forError(page.error)}</ErrorBanner>;
  }

  const connected = page.data.page;

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorBanner>{forCode(error)}</ErrorBanner>}
      {!connected && step !== 'choose-page' && <NotConnectedNotice />}
      {step === 'choose-page' ? (
        <ChoosePageCard currentPageId={connected?.pageId} onDone={onFlowDone} />
      ) : connected ? (
        <ConnectedPageCard page={connected} />
      ) : (
        <ConnectPageCard />
      )}
    </div>
  );
}
