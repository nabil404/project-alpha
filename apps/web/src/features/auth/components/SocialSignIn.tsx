import { useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';

import { useSocialSignIn, type SocialProvider } from '../queries';
import { FacebookLogo, GoogleLogo } from './ProviderLogos';

/**
 * "or continue with" Google / Facebook. Signing up and signing in are the same
 * step for a social account, so both pages render this unchanged.
 */
export function SocialSignIn({ callbackURL }: { callbackURL: string }) {
  const { t } = useTranslation('auth');
  const { forError } = useErrorMessages();
  const socialSignIn = useSocialSignIn();

  const providers: { id: SocialProvider; label: string; Logo: () => React.JSX.Element }[] = [
    { id: 'facebook', label: t('social.facebook'), Logo: FacebookLogo },
    { id: 'google', label: t('social.google'), Logo: GoogleLogo },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="h-px grow bg-border" />
        <span className="text-small text-ink-muted">{t('social.divider')}</span>
        <div className="h-px grow bg-border" />
      </div>
      <div className="flex justify-center gap-3">
        {providers.map(({ id, label, Logo }) => (
          <Button
            key={id}
            type="button"
            aria-label={label}
            title={label}
            disabled={socialSignIn.isPending}
            onClick={() => socialSignIn.mutate({ provider: id, callbackURL })}
            className="h-11 w-16 px-0"
          >
            <Logo />
          </Button>
        ))}
      </div>
      {socialSignIn.isError ? <ErrorBanner>{forError(socialSignIn.error)}</ErrorBanner> : null}
    </div>
  );
}
