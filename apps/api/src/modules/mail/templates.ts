import { compileLinkEmail, fillLink, type LinkEmailCopy } from './layout';

/**
 * Transactional email bodies. Each takes the link Better Auth built - which
 * carries a single-use token - and returns plain text alongside the MJML-built
 * HTML, so the message still reads in clients that strip markup.
 *
 * The token lives only in the body. Subjects and anything a caller might log
 * stay generic.
 */
export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export interface MailMessage extends MailContent {
  to: string;
}

interface LinkEmail extends LinkEmailCopy {
  subject: string;
}

const verification: LinkEmail = {
  subject: 'Verify your email address',
  preview: 'Confirm your email address to finish setting up your account.',
  heading: 'Verify your email address',
  intro: 'Welcome! Confirm your email address to finish setting up your account.',
  action: 'Verify email',
  outro:
    "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
};

const resetPassword: LinkEmail = {
  subject: 'Reset your password',
  preview: 'Use this link to choose a new password.',
  heading: 'Reset your password',
  intro: 'We received a request to reset the password for your account.',
  action: 'Choose a new password',
  outro:
    "This link expires in 1 hour and can be used once. If you didn't ask for this, you can ignore this email - your password stays the same.",
};

const existingAccount: LinkEmail = {
  subject: 'You already have an account',
  preview: 'This email address already has an account.',
  heading: 'You already have an account',
  intro:
    'Someone - hopefully you - tried to sign up with this email address, but it already has an account.',
  action: 'Sign in',
  outro:
    'If you\'ve forgotten your password, use "Forgot password" on the sign-in page. If this wasn\'t you, you can ignore this email.',
};

// Compiled once at module load; see layout.ts for why.
const [verificationHtml, resetPasswordHtml, existingAccountHtml] = await Promise.all(
  [verification, resetPassword, existingAccount].map(compileLinkEmail),
);

function withLink(email: LinkEmail, html: string, url: string): MailContent {
  return {
    subject: email.subject,
    text: `${email.intro}\n\n${email.action}: ${url}\n\n${email.outro}\n`,
    html: fillLink(html, url),
  };
}

export function verificationEmail(url: string): MailContent {
  return withLink(verification, verificationHtml!, url);
}

export function resetPasswordEmail(url: string): MailContent {
  return withLink(resetPassword, resetPasswordHtml!, url);
}

/**
 * Sent instead of an error when someone signs up with an email that already
 * has an account. The API answers that sign-up exactly like a fresh one, so the
 * form never reveals which addresses are registered; this tells the real owner
 * where to go instead.
 */
export function existingAccountEmail(signInUrl: string): MailContent {
  return withLink(existingAccount, existingAccountHtml!, signInUrl);
}
