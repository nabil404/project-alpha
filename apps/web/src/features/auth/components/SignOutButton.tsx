import { useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { useSignOut } from '../queries';

export function SignOutButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signOut = useSignOut();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={signOut.isPending}
      onClick={() =>
        signOut.mutate(undefined, {
          onSuccess: () => navigate({ to: '/sign-in', replace: true }),
        })
      }
    >
      <LogOut aria-hidden strokeWidth={1.5} />
      {t('actions.signOut')}
    </Button>
  );
}
