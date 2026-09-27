import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from '@tanstack/react-router';
import { signInSchema, type SignInInput } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

import { useSignIn } from '../queries';
import { AuthCard, AuthCardFooter } from './AuthCard';
import { PasswordInput } from './PasswordInput';
import { SocialSignIn } from './SocialSignIn';

const serverFields = ['email', 'password'] as const;

export function SignInForm({
  redirectTo,
  initialError,
}: {
  /** A same-origin path, already checked with safeRedirect. */
  redirectTo: string;
  /** A message from the page that sent the seller here, e.g. an expired email link. */
  initialError?: string;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const { forError, forField } = useErrorMessages();
  const navigate = useNavigate();
  const signIn = useSignIn();

  const form = useForm<SignInInput>({
    resolver: useZodResolver(signInSchema),
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  const onSubmit = (values: SignInInput) =>
    signIn.mutate(values, {
      onSuccess: () => navigate({ href: redirectTo, replace: true }),
      onError: (error) => applyServerFieldErrors(error, form.setError, serverFields, forField),
    });

  const bannerMessage = signIn.isError ? forError(signIn.error) : initialError;

  return (
    <AuthCard title={t('signIn.title')} description={t('signIn.description')}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          {bannerMessage ? <ErrorBanner>{bannerMessage}</ErrorBanner> : null}

          <div className="flex flex-col gap-4">
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
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.password')}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormLabel className="cursor-pointer text-body font-normal">
                    {t('signIn.rememberMe')}
                  </FormLabel>
                </FormItem>
              )}
            />
          </div>

          <Button type="submit" variant="primary" disabled={signIn.isPending}>
            {t('signIn.submit')}
          </Button>
        </form>
      </Form>

      <SocialSignIn callbackURL={redirectTo} />

      <AuthCardFooter>
        {t('signIn.newHere', { app: t('common:app.name') })}{' '}
        <Link to="/sign-up" className="font-medium text-link hover:underline">
          {t('signIn.createAccount')}
        </Link>
      </AuthCardFooter>
    </AuthCard>
  );
}
