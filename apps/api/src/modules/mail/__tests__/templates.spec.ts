import { compileLinkEmail, fillLink, LINK_SLOT } from '../layout';
import { existingAccountEmail, resetPasswordEmail, verificationEmail } from '../templates';

const url = 'https://orders.example.com/api/v1/auth/verify-email?token=abc.def&callbackURL=%2F';

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

  it('fills every link slot', () => {
    expect(mail.html).not.toContain(LINK_SLOT);
  });

  it('renders a full MJML document', () => {
    expect(mail.html).toMatch(/^<!doctype html>/i);
    expect(mail.html).toContain('</html>');
  });

  it('keeps the token out of the subject', () => {
    expect(mail.subject).not.toContain('abc.def');
    expect(mail.subject.length).toBeGreaterThan(0);
  });
});

describe('fillLink', () => {
  it('keeps replacement patterns in a URL literal', () => {
    const html = fillLink(`<a href="${LINK_SLOT}">${LINK_SLOT}</a>`, 'https://x.test/?a=$&b=$1');
    expect(html).toBe('<a href="https://x.test/?a=$&amp;b=$1">https://x.test/?a=$&amp;b=$1</a>');
  });
});

describe('compileLinkEmail', () => {
  it('escapes the copy', async () => {
    const html = await compileLinkEmail({
      preview: 'p',
      heading: '<script>alert(1)</script>',
      intro: 'i',
      action: 'a',
      outro: 'o',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
