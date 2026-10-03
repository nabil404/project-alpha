import { z } from 'zod';
import { errorCodeSchema } from '../errors/codes';
import { e164PhoneSchema } from '../region/phone';

/**
 * Better Auth enforces these on sign-up and password reset, and the API reads
 * them from here, so a form built on passwordSchema can never accept a
 * password the server then rejects.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const NAME_MAX_LENGTH = 100;
export const PHONE_MAX_LENGTH = 20;

/** E.164 caps a number at 15 digits; fewer than 7 is not a reachable phone. */
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

/**
 * Digits with the separators people actually type - `01712-345678`,
 * `+880 1712 345678`, `(017) 1234 5678`, stored as typed. Only for numbers
 * whose country is unknown (a customer's, read from a chat); the seller's own
 * is checked against its country with e164PhoneSchema.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, { abort: true })
  .max(PHONE_MAX_LENGTH, { abort: true })
  .refine(
    (value) => {
      const digits = value.replace(/\D/g, '').length;
      return (
        /^\+?[\d\s()-]+$/.test(value) && digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS
      );
    },
    { params: { code: 'INVALID_PHONE' } },
  );

/**
 * The email sign-up form, and what the API's hook on /auth/sign-up/email
 * validates before Better Auth sees the body. `shopName` names the seller's
 * organization; `phone` is stored on the user, in E.164.
 */
export const signUpSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  shopName: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  email: z.email(),
  phone: e164PhoneSchema,
  password: passwordSchema,
});
export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Sign-in checks presence only: the length rules belong to choosing a
 * password, and repeating them here would tell a guesser which inputs are
 * never worth sending.
 */
export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  rememberMe: z.boolean(),
});
export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Seconds a password-reset link stays valid. Better Auth enforces it, and the
 * SPA quotes it ("It expires in 60 minutes"), so both read it from here.
 */
export const RESET_PASSWORD_TOKEN_TTL = 60 * 60;

/** Forgot password: an unknown email gets the same answer as a known one. */
export const requestPasswordResetSchema = z.object({
  email: z.email(),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

/** The new password sent with the emailed token, under Better Auth's field name. */
export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Settings > Account, where a seller links Google or Facebook to the account
 * they are signed in to. Better Auth's callback lands a failed link here with
 * `error=<ErrorCode>`.
 */
export const ACCOUNT_SETTINGS_PATH = '/settings/account';

export const accountSettingsSearchSchema = z.object({
  error: errorCodeSchema.optional().catch(undefined),
});
export type AccountSettingsSearch = z.infer<typeof accountSettingsSearchSchema>;
