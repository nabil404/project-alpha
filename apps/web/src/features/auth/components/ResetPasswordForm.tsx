import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, resetPasswordSchema } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';

import { useResetPassword } from '../queries';
import { AuthCard, AuthCardFooter, AuthCardIcon } from './AuthCard';
import { PasswordInput } from './PasswordInput';

const serverFields = ['newPassword'] as const;

export function ResetPasswordForm({
  token,
  onReset,
}: {
  /** The single-use token from the emailed link. */
  token: string;
  onReset: () => void;
}) {
  const { t } = useTranslation('auth');
  const { forError, forField } = useErrorMessages();
  const resetPassword = useResetPassword();

  // Typing it twice is the form's business; the API only takes newPassword.
  const schema = useMemo(
    () =>
      resetPasswordSchema
        .extend({ confirmPassword: z.string() })
        .refine((values) => values.newPassword === values.confirmPassword, {
          path: ['confirmPassword'],
          error: t('resetPassword.mismatch'),
        }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: useZodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = ({ newPassword }: FormValues) =>
    resetPassword.mutate(
      { token, newPassword },
      {
        onSuccess: onReset,
        onError: (error) => applyServerFieldErrors(error, form.setError, serverFields, forField),
      },
    );

  return (
    <AuthCard
      icon={<AuthCardIcon icon={KeyRound} />}
      title={t('resetPassword.title')}
      description={t('resetPassword.description')}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          {/* An expired token lands here too: AUTH_INVALID_TOKEN reads "request a new one". */}
          {resetPassword.isError ? (
            <ErrorBanner>{forError(resetPassword.error)}</ErrorBanner>
          ) : null}

          <div className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('resetPassword.newPassword')}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('signUp.passwordHint', { min: PASSWORD_MIN_LENGTH })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('resetPassword.confirmPassword')}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <Button type="submit" variant="primary" disabled={resetPassword.isPending}>
            {t('resetPassword.submit')}
          </Button>
        </form>
      </Form>

      <AuthCardFooter>
        <Link to="/sign-in" className="font-medium text-link hover:underline">
          {t('backToSignIn')}
        </Link>
      </AuthCardFooter>
    </AuthCard>
  );
}
