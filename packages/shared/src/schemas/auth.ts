import { z } from 'zod';

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
 * `+880 1712 345678`, `(017) 1234 5678`. Stored as typed: it is how the seller
 * is reached about their account, not a key anything is looked up by.
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
 * organization; `phone` is stored on the user.
 */
export const signUpSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  shopName: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  email: z.email(),
  phone: phoneSchema,
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
