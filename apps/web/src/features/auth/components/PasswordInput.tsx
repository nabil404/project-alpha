import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** A password field with a Show / Hide toggle, so a seller on a phone can check what they typed. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const { t } = useTranslation('auth');
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={cn('pr-18', className)} />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? t('password.hideLabel') : t('password.showLabel')}
        className="absolute top-1 right-1 h-8 cursor-pointer rounded-sm px-3 text-label text-ink-muted transition-colors duration-[120ms] hover:bg-surface-hover hover:text-ink"
      >
        {shown ? t('password.hide') : t('password.show')}
      </button>
    </div>
  );
}
