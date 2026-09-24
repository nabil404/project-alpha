/**
 * Transactional email bodies. Each takes the link Better Auth built - which
 * carries a single-use token - and returns plain text alongside HTML, so the
 * message still reads in clients that strip markup.
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

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function withLink(subject: string, intro: string, action: string, url: string, outro: string) {
  const href = escapeHtml(url);

  return {
    subject,
    text: `${intro}\n\n${action}: ${url}\n\n${outro}\n`,
    html: [
      `<p>${escapeHtml(intro)}</p>`,
      `<p><a href="${href}">${escapeHtml(action)}</a></p>`,
      `<p>Or paste this link into your browser:<br>${href}</p>`,
      `<p>${escapeHtml(outro)}</p>`,
    ].join('\n'),
  } satisfies MailContent;
}

export function verificationEmail(url: string): MailContent {
  return withLink(
    'Verify your email address',
    'Welcome! Confirm your email address to finish setting up your account.',
    'Verify email',
    url,
    "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
  );
}

export function resetPasswordEmail(url: string): MailContent {
  return withLink(
    'Reset your password',
    'We received a request to reset the password for your account.',
    'Choose a new password',
    url,
    "This link expires in 1 hour and can be used once. If you didn't ask for this, you can ignore this email - your password stays the same.",
  );
}

/**
 * Sent instead of an error when someone signs up with an email that already
 * has an account. The API answers that sign-up exactly like a fresh one, so the
 * form never reveals which addresses are registered; this tells the real owner
 * where to go instead.
 */
export function existingAccountEmail(signInUrl: string): MailContent {
  return withLink(
    'You already have an account',
    'Someone - hopefully you - tried to sign up with this email address, but it already has an account.',
    'Sign in',
    signInUrl,
    'If you\'ve forgotten your password, use "Forgot password" on the sign-in page. If this wasn\'t you, you can ignore this email.',
  );
}
