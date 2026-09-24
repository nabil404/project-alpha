import { z } from 'zod';

/**
 * Better Auth enforces these on sign-up and password reset, and the API reads
 * them from here, so a form built on passwordSchema can never accept a
 * password the server then rejects.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
