import { existingAccountEmail, resetPasswordEmail, verificationEmail } from '../templates.js';

const url = 'https://orders.example.com/api/auth/verify-email?token=abc.def&callbackURL=%2F';

describe.each([
  ['verificationEmail', verificationEmail],
  ['resetPasswordEmail', resetPasswordEmail],
  ['existingAccountEmail', existingAccountEmail],
])('%s', (_name, template) => {
  const mail = template(url);

  it('puts the link in the text body verbatim', () => {
    expect(mail.text).toContain(url);
  });

  it('escapes the link in the HTML body', () => {
    expect(mail.html).toContain(`href="${url.replaceAll('&', '&amp;')}"`);
    expect(mail.html).not.toContain('token=abc.def&callbackURL');
  });

  it('keeps the token out of the subject', () => {
    expect(mail.subject).not.toContain('abc.def');
    expect(mail.subject.length).toBeGreaterThan(0);
  });
});
