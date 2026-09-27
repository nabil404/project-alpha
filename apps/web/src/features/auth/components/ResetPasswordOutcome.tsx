import { Link } from '@tanstack/react-router';
import { CircleCheck, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { AuthCard, AuthCardFooter, AuthCardIcon } from './AuthCard';

/** The reset went through; every session, this one included, has been ended. */
export function PasswordUpdatedNotice() {
  const { t } = useTranslation('auth');

  return (
    <AuthCard
      icon={<AuthCardIcon icon={CircleCheck} tone="success" />}
      title={t('passwordUpdated.title')}
      description={t('passwordUpdated.description')}
    >
      <Button asChild variant="primary">
        <Link to="/sign-in" replace>
          {t('passwordUpdated.signIn')}
        </Link>
      </Button>
    </AuthCard>
  );
}

/** The emailed link had no token, or Better Auth sent it back as `?error=INVALID_TOKEN`. */
export function InvalidResetLinkNotice() {
  const { t } = useTranslation('auth');

  return (
    <AuthCard
      icon={<AuthCardIcon icon={KeyRound} />}
      title={t('resetPassword.invalidLink.title')}
      description={t('resetPassword.invalidLink.description')}
    >
      <Button asChild variant="primary">
        <Link to="/forgot-password">{t('resetPassword.invalidLink.requestNew')}</Link>
      </Button>

      <AuthCardFooter>
        <Link to="/sign-in" className="font-medium text-link hover:underline">
          {t('backToSignIn')}
        </Link>
      </AuthCardFooter>
    </AuthCard>
  );
}
