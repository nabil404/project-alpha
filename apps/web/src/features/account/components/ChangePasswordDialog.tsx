import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { changePasswordSchema, PASSWORD_MIN_LENGTH, type ChangePasswordInput } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PasswordInput } from '@/features/auth';
import { useErrorMessages } from '@/i18n/error-keys';
import { ApiError } from '@/lib/api-error';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';

import { useChangePassword } from '../queries';

const serverFields = ['newPassword'] as const;
const defaultValues: ChangePasswordInput = {
  currentPassword: '',
  newPassword: '',
  revokeOtherSessions: true,
};

/**
 * "Sign out of other devices" starts checked: a seller changing their password
 * is often doing it because they suspect someone else has it.
 */
export function ChangePasswordDialog({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation(['settings', 'common']);
  const { forError, forCode, forField } = useErrorMessages();
  const [open, setOpen] = useState(false);
  const change = useChangePassword();

  const form = useForm<ChangePasswordInput>({
    resolver: useZodResolver(changePasswordSchema),
    defaultValues,
  });

  const onOpenChange = (next: boolean) => {
    // Closing resets the mutation, which would drop the per-call onSuccess
    // and lose the "Password changed." confirmation.
    if (!next && change.isPending) return;
    setOpen(next);
    if (!next) {
      form.reset(defaultValues);
      change.reset();
    }
  };

  const onSubmit = (values: ChangePasswordInput) =>
    change.mutate(values, {
      onSuccess: () => {
        onOpenChange(false);
        onChanged();
      },
      onError: (error) => {
        // A field error is shown under the field; only unplaced errors keep the banner.
        if (error instanceof ApiError && error.code === 'AUTH_WRONG_PASSWORD') {
          form.setError(
            'currentPassword',
            { type: 'server', message: forCode(error.code) },
            { shouldFocus: true },
          );
          change.reset();
          return;
        }
        if (applyServerFieldErrors(error, form.setError, serverFields, forField)) change.reset();
      },
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <KeyRound aria-hidden strokeWidth={1.5} />
          {t('account.password.change')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('account.password.dialog.title')}</DialogTitle>
          <DialogDescription>{t('account.password.dialog.description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
            {change.isError && <ErrorBanner>{forError(change.error)}</ErrorBanner>}
            <div className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('account.password.dialog.current')}</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('account.password.dialog.new')}</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('account.password.dialog.newHint', { min: PASSWORD_MIN_LENGTH })}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="revokeOtherSessions"
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
                    <FormLabel className="font-normal">
                      {t('account.password.dialog.revokeOthers')}
                    </FormLabel>
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" disabled={change.isPending}>
                  {t('common:actions.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={change.isPending}>
                {t('account.password.dialog.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
