import { customerWaitingEmail, dailySummaryEmail, orderDraftedEmail } from '../notification-emails';

const appUrl = 'https://app.example.test';

describe('notification emails', () => {
  it('links a drafted order and the settings that turn the email off', () => {
    const mail = orderDraftedEmail({
      appUrl,
      shopName: "Rahim's Kitchen",
      orderId: 'order-1',
      reference: 'ORD-2026-00481',
      customerName: 'Nusrat Jahan',
      total: 'BDT 1,600.00',
    });

    expect(mail.subject).toBe('New order ORD-2026-00481');
    expect(mail.text).toContain('Nusrat Jahan confirmed an order for BDT 1,600.00');
    expect(mail.text).toContain(`${appUrl}/orders/order-1`);
    expect(mail.text).toContain(`${appUrl}/settings/notifications`);
    expect(mail.html).toContain(`href="${appUrl}/orders/order-1"`);
  });

  it('escapes names in the HTML body', () => {
    const mail = customerWaitingEmail({
      appUrl,
      shopName: '<b>Shop</b>',
      conversationId: 'c-1',
      customerName: 'Tom & "Jerry"',
      waitingMinutes: 10,
    });

    expect(mail.html).toContain('Tom &amp; &quot;Jerry&quot;');
    expect(mail.html).toContain('&lt;b&gt;Shop&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Shop</b>');
    expect(mail.text).toContain(`${appUrl}/conversations/c-1`);
  });

  it('names an unnamed customer generically', () => {
    const mail = customerWaitingEmail({
      appUrl,
      shopName: 'Shop',
      conversationId: 'c-1',
      customerName: null,
      waitingMinutes: 10,
    });

    expect(mail.subject).toBe('A customer is waiting for you');
  });

  it('counts one order in the singular', () => {
    const one = dailySummaryEmail({
      appUrl,
      shopName: 'Shop',
      date: '6 Oct 2026',
      orders: 1,
      revenue: 'BDT 900.00',
    });
    const many = dailySummaryEmail({
      appUrl,
      shopName: 'Shop',
      date: '6 Oct 2026',
      orders: 4,
      revenue: 'BDT 9,000.00',
    });

    expect(one.subject).toBe('Shop: 1 order on 6 Oct 2026');
    expect(many.subject).toBe('Shop: 4 orders on 6 Oct 2026');
  });
});
