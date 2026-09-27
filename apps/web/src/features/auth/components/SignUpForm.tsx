import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, signUpSchema, type SignUpInput } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';

import { PRIVACY_URL, TERMS_URL } from '../legal';
import { useSignUp } from '../queries';
import { AuthCard, AuthCardFooter } from './AuthCard';
import { PasswordInput } from './PasswordInput';
import { SocialSignIn } from './SocialSignIn';

const serverFields = ['name', 'shopName', 'email', 'phone', 'password'] as const;

export type SignUpDraft = Omit<SignUpInput, 'password'>;

export function SignUpForm({
  defaultValues,
  onSignedUp,
}: {
  /** What the seller typed last time, when they come back to fix their email. */
  defaultValues?: SignUpDraft;
  onSignedUp: (input: SignUpInput) => void;
}) {
  const { t } = useTranslation('auth');
  const { forError, forField } = useErrorMessages();
  const signUp = useSignUp();

  // Agreeing to the terms is the form's business alone - the API has nothing
  // to store it in yet - so it is added here rather than to the shared schema.
  const schema = useMemo(
    () =>
      signUpSchema.extend({
        acceptTerms: z
          .boolean()
          .refine((accepted) => accepted, { error: t('signUp.termsRequired') }),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: useZodResolver(schema),
    defaultValues: {
      name: '',
      shopName: '',
      email: '',
      phone: '',
      ...defaultValues,
      password: '',
      acceptTerms: false,
    },
  });

  const onSubmit = ({ acceptTerms: _, ...input }: FormValues) =>
    signUp.mutate(input, {
      onSuccess: () => onSignedUp(input),
      onError: (error) => applyServerFieldErrors(error, form.setError, serverFields, forField),
    });

  return (
    <AuthCard
      title={t('signUp.title')}
      description={t('signUp.description')}
      className="max-w-[480px]"
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          {signUp.isError ? <ErrorBanner>{forError(signUp.error)}</ErrorBanner> : null}

          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.name')}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="name"
                        placeholder={t('fields.namePlaceholder')}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="shopName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.shopName')}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="organization"
                        placeholder={t('fields.shopNamePlaceholder')}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.phone')}</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      autoComplete="tel"
                      placeholder={t('fields.phonePlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t('fields.phoneHint')}</FormDescription>
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
              name="acceptTerms"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-start gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                        className="mt-[3px]"
                      />
                    </FormControl>
                    <FormLabel className="cursor-pointer text-body font-normal">
                      <Trans
                        t={t}
                        i18nKey="signUp.terms"
                        components={{
                          terms: <LegalLink href={TERMS_URL} />,
                          privacy: <LegalLink href={PRIVACY_URL} />,
                        }}
                      />
                    </FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <Button type="submit" variant="primary" disabled={signUp.isPending}>
            {t('signUp.submit')}
          </Button>
        </form>
      </Form>

      <SocialSignIn callbackURL="/" />

      <AuthCardFooter>
        {t('signUp.haveAccount')}{' '}
        <Link to="/sign-in" className="font-medium text-link hover:underline">
          {t('signUp.signIn')}
        </Link>
      </AuthCardFooter>
    </AuthCard>
  );
}

/** Opens in a new tab so a half-filled form isn't lost. Trans fills in the text. */
function LegalLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-link hover:underline">
      {children}
    </a>
  );
}
