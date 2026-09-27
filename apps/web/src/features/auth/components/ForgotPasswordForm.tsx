import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { requestPasswordResetSchema, type RequestPasswordResetInput } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';

import { useRequestPasswordReset } from '../queries';
import { AuthCard, AuthCardFooter } from './AuthCard';

const serverFields = ['email'] as const;

export function ForgotPasswordForm({ onSent }: { onSent: (email: string) => void }) {
  const { t } = useTranslation('auth');
  const { forError, forField } = useErrorMessages();
  const requestReset = useRequestPasswordReset();

  const form = useForm<RequestPasswordResetInput>({
    resolver: useZodResolver(requestPasswordResetSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = (values: RequestPasswordResetInput) =>
    requestReset.mutate(values, {
      onSuccess: () => onSent(values.email),
      onError: (error) => applyServerFieldErrors(error, form.setError, serverFields, forField),
    });

  return (
    <AuthCard title={t('forgotPassword.title')} description={t('forgotPassword.description')}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          {requestReset.isError ? <ErrorBanner>{forError(requestReset.error)}</ErrorBanner> : null}

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.email')}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder={t('fields.emailPlaceholder')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" variant="primary" disabled={requestReset.isPending}>
            {t('forgotPassword.submit')}
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
