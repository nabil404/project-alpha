import { useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import {
  AVATAR_ACCEPTED_TYPES,
  AVATAR_MAX_BYTES,
  AVATAR_MIN_SIDE,
  updateProfileSchema,
  type ErrorCode,
  type UpdateProfileInput,
} from '@app/shared';

import { Avatar } from '@/components/Avatar';
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
import { Label } from '@/components/ui/label';
import { sessionQueryOptions, type SessionUser } from '@/features/auth';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';

import { useRemoveAvatar, useUpdateProfile, useUploadAvatar } from '../queries';
import { CardSkeleton } from './CardSkeleton';

const serverFields = ['name'] as const;
const acceptedTypes: readonly string[] = AVATAR_ACCEPTED_TYPES;

/** Settings > Account: the seller's name and photo. Email is shown, never edited. */
export function ProfileCard() {
  const session = useQuery(sessionQueryOptions());

  if (!session.data) {
    return <CardSkeleton />;
  }
  return <ProfileForm user={session.data.user} />;
}

function ProfileForm({ user }: { user: SessionUser }) {
  const { t } = useTranslation(['settings', 'common']);
  const { forError, forCode, forField } = useErrorMessages();
  const update = useUpdateProfile();
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const [fileError, setFileError] = useState<ErrorCode | null>(null);

  const form = useForm<UpdateProfileInput>({
    resolver: useZodResolver(updateProfileSchema),
    defaultValues: { name: user.name },
  });

  const onSubmit = (values: UpdateProfileInput) =>
    update.mutate(values, {
      // The saved (trimmed) name becomes the new baseline, so Save and Cancel go quiet.
      onSuccess: () => form.reset(values),
      onError: (error) => applyServerFieldErrors(error, form.setError, serverFields, forField),
    });

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared, so picking the same file again after a failure uploads again.
    event.target.value = '';
    if (!file) return;

    remove.reset();
    upload.reset();
    if (!acceptedTypes.includes(file.type)) {
      setFileError('AVATAR_UNSUPPORTED_TYPE');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setFileError('AVATAR_TOO_LARGE');
      return;
    }
    setFileError(null);
    upload.mutate(file);
  };

  const photoBusy = upload.isPending || remove.isPending;
  const photoError = fileError
    ? forCode(fileError)
    : upload.isError
      ? forError(upload.error)
      : remove.isError
        ? forError(remove.error)
        : null;

  return (
    <section className="flex flex-col rounded-lg border border-border bg-surface shadow-card">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-6 p-6">
            <h2 className="text-heading">{t('account.profile.title')}</h2>

            {photoError && <ErrorBanner>{photoError}</ErrorBanner>}
            {update.isError && !form.formState.errors.name && (
              <ErrorBanner>{forError(update.error)}</ErrorBanner>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Avatar
                name={user.name}
                image={user.image}
                className={`size-16 text-heading ${photoBusy ? 'opacity-50' : ''}`}
              />
              <div className="flex min-w-40 flex-1 flex-col gap-0.5">
                <span className="text-label font-medium">{t('account.profile.photo')}</span>
                <span className="text-small text-ink-muted">
                  {t('account.profile.photoHint', { minSide: AVATAR_MIN_SIDE })}
                </span>
              </div>
              <div className="flex gap-2" aria-busy={photoBusy}>
                <label
                  className={`inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-body font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
                    photoBusy
                      ? 'cursor-not-allowed text-ink-disabled'
                      : 'cursor-pointer hover:bg-surface-hover'
                  }`}
                >
                  <Upload aria-hidden className="size-4" strokeWidth={1.5} />
                  {t('account.profile.uploadPhoto')}
                  <input
                    type="file"
                    accept={AVATAR_ACCEPTED_TYPES.join(',')}
                    className="sr-only"
                    disabled={photoBusy}
                    onChange={onPickFile}
                  />
                </label>
                {user.image && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-danger"
                    disabled={photoBusy}
                    onClick={() => {
                      setFileError(null);
                      upload.reset();
                      remove.mutate();
                    }}
                  >
                    {t('account.profile.removePhoto')}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('account.profile.name')}</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-email" className="text-ink-disabled">
                  {t('account.profile.email')}
                </Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={user.email}
                  disabled
                  readOnly
                  aria-describedby="profile-email-hint"
                />
                <span id="profile-email-hint" className="text-small text-ink-muted">
                  {t('account.profile.emailHint')}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            {update.isSuccess && !form.formState.isDirty && (
              <span role="status" className="mr-auto text-small text-success">
                {t('account.profile.saved')}
              </span>
            )}
            <Button
              type="button"
              disabled={!form.formState.isDirty || update.isPending}
              onClick={() => {
                form.reset();
                update.reset();
              }}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!form.formState.isDirty || update.isPending}
            >
              {t('common:actions.save')}
            </Button>
          </div>
        </form>
      </Form>
    </section>
  );
}
