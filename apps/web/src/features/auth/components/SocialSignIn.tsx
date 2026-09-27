import { useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';

import { useSocialSignIn, type SocialProvider } from '../queries';

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

// Brand marks keep their own colours: the providers' guidelines require them,
// which is why these are the one place outside index.css with raw hex values.

function GoogleLogo() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.56 10.56 0 0 0 12 1 11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.7 4.53-4.7 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.88v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"
      />
    </svg>
  );
}
