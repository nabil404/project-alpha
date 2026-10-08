import { compileEmail, heading } from '../layout';
import {
  customerWaitingEmail,
  dailySummaryEmail,
  existingAccountEmail,
  newOrderEmail,
  resetPasswordEmail,
  verificationEmail,
  type MailContent,
} from '../templates';

const url = 'https://orders.example.com/api/v1/auth/verify-email?token=abc.def&callbackURL=%2F';
const escapedUrl = url.replaceAll('&', '&amp;');

describe.each([
  ['verificationEmail', () => verificationEmail(url)],
  ['resetPasswordEmail', () => resetPasswordEmail(url)],
  [
    'existingAccountEmail',
    () =>
      existingAccountEmail({
        signInUrl: url,
        forgotPasswordUrl: 'https://orders.example.com/forgot-password',
      }),
  ],
])('%s', (_name, render) => {
  const mail = render();

  it('puts the link in the text body verbatim', () => {
    expect(mail.text).toContain(url);
  });

  it('escapes the link in the HTML body', () => {
    expect(mail.html).toContain(`href="${escapedUrl}"`);
    expect(mail.html).not.toContain('token=abc.def&callbackURL');
  });

  it('keeps the token out of the subject', () => {
    expect(mail.subject).not.toContain('abc.def');
    expect(mail.subject.length).toBeGreaterThan(0);
  });
});

const hostile = `<img src=x onerror=alert(1)> & "Rahim's"`;

const notifications: [string, () => MailContent][] = [
  [
    'newOrderEmail',
    () =>
      newOrderEmail({
        orderNumber: 'ORD-2026-00481',
        customerName: hostile,
        shopName: "Rahim's Kitchen",
        total: '৳ 3,260',
        orderUrl: url,
        settingsUrl: 'https://orders.example.com/settings',
      }),
  ],
  [
    'customerWaitingEmail',
    () =>
      customerWaitingEmail({
        customerName: hostile,
        shopName: "Rahim's Kitchen",
        waitingMinutes: 10,
        conversationUrl: url,
        settingsUrl: 'https://orders.example.com/settings',
      }),
  ],
  [
    'dailySummaryEmail',
    () =>
      dailySummaryEmail({
        shopName: hostile,
        date: '6 Oct 2026',
        orderCount: 14,
        revenue: '৳ 48,250',
        ordersUrl: url,
        settingsUrl: 'https://orders.example.com/settings',
      }),
  ],
];

describe.each(notifications)('%s', (_name, render) => {
  const mail = render();

  it('escapes values from customers and sellers', () => {
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Rahim&#39;s&quot;');
  });

  it('links to the dashboard and the notification settings', () => {
    expect(mail.html).toContain(`href="${escapedUrl}"`);
    expect(mail.html).toContain('href="https://orders.example.com/settings"');
    expect(mail.text).toContain(url);
  });
});

describe.each([['verificationEmail', () => verificationEmail(url)], ...notifications])(
  '%s HTML',
  (_name, render) => {
    const mail = render();

    it('is a full document with every slot filled', () => {
      expect(mail.html).toMatch(/^<!doctype html>/i);
      expect(mail.html).toContain('</html>');
      expect(mail.html).not.toMatch(/__SLOT_/);
    });
  },
);

describe('plurals', () => {
  it('says "1 minute" and "1 order"', () => {
    const waiting = customerWaitingEmail({
      customerName: 'Nusrat Jahan',
      shopName: 'Shop',
      waitingMinutes: 1,
      conversationUrl: url,
      settingsUrl: url,
    });
    expect(waiting.text).toContain('to you 1 minute ago');

    const summary = dailySummaryEmail({
      shopName: 'Shop',
      date: '6 Oct 2026',
      orderCount: 1,
      revenue: '৳ 500',
      ordersUrl: url,
      settingsUrl: url,
    });
    expect(summary.subject).toBe('Shop: 1 order on 6 Oct 2026');
  });
});

describe('compileEmail', () => {
  it('keeps replacement patterns in a value literal', async () => {
    const fill = await compileEmail<'name'>({ preview: 'p', card: [heading('Hello {name}')] });
    expect(fill({ subject: 's', name: '$& $1' })).toContain('Hello $&amp; $1');
  });

  it('escapes fixed copy', async () => {
    const fill = await compileEmail({ preview: 'p', card: [heading('<script>alert(1)</script>')] });
    const html = fill({ subject: 's' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('refuses to send an email with a slot left empty', async () => {
    const fill = await compileEmail<'name'>({ preview: 'p', card: [heading('Hello {name}')] });
    expect(() => fill({ subject: 's' } as never)).toThrow('Email slot "name" has no value');
  });
});
