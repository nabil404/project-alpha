import { z } from 'zod';
import { NAME_MAX_LENGTH, passwordSchema } from './auth';

/**
 * Settings > Account. The API enforces the avatar limits after decoding; the
 * SPA checks type and size first only so a seller hears about a wrong file
 * before it uploads.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIN_SIDE = 256;
export const AVATAR_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** What the API's hook on /auth/update-user validates before Better Auth sees the body. */
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Better Auth's /change-password body. The current password is checked for
 * presence only, as on sign-in: its length rules belong to choosing one.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
  revokeOtherSessions: z.boolean(),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** PUT and DELETE /account/avatar. `null` once the photo is removed. */
export const accountAvatarSchema = z.object({
  image: z.string().nullable(),
});
export type AccountAvatar = z.infer<typeof accountAvatarSchema>;

/**
 * One signed-in device, from GET /account/sessions. Never carries the session
 * token or IP address. `lastActiveAt` moves only when Better Auth refreshes
 * the session, about once a day, so it is shown to the day.
 */
export const deviceSessionSchema = z.object({
  id: z.string(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  current: z.boolean(),
});
export type DeviceSession = z.infer<typeof deviceSessionSchema>;
