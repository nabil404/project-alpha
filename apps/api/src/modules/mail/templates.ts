import {
  button,
  compileEmail,
  details,
  divider,
  heading,
  linkFallback,
  note,
  paragraph,
  pill,
  stats,
} from './layout';

/**
 * Transactional email bodies: plain text alongside the MJML-built HTML, so the
 * message still reads in clients that strip markup. Copy and layout follow the
 * email designs on the dashboard's design canvas.
 *
 * Auth emails carry a single-use token in their link. The token lives only in
 * the body; subjects and anything a caller might log stay generic.
 *
 * Notification emails take display strings for money and dates, already
 * formatted for the shop (`formatMinorUnits`, `formatShopDate` from
 * `@app/shared`), because the shop's currency, locale and time zone are the
 * caller's to know; `notifications/notification-emails.ts` supplies them.
 * Every value is escaped into the HTML.
 */
export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export interface MailMessage extends MailContent {
  to: string;
}

const count = new Intl.NumberFormat('en-US');
const plural = (n: number, one: string, many: string) =>
  `${count.format(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Compiled once at module load; see layout.ts for why.

const settingsFooter = (setting: string) => [
  note(
    `You get this email because "${setting}" is on in your notification settings. [Change them](settingsUrl).`,
    '8px',
  ),
];

const [verifyHtml, resetHtml, existingHtml, newOrderHtml, waitingHtml, summaryHtml] =
  await Promise.all([
    compileEmail<'url'>({
      preview: 'Confirm your email address to finish setting up your account.',
      card: [
        heading('Confirm your email address'),
        paragraph('Welcome! Confirm your email address to finish setting up your account.'),
        button('Verify email', 'url'),
        linkFallback('url'),
        divider(),
        note(
          "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
        ),
      ],
    }),
    compileEmail<'url'>({
      preview: 'Use this link to choose a new password.',
      card: [
        heading('Reset your password'),
        paragraph('We received a request to reset the password for your account.'),
        button('Choose a new password', 'url'),
        linkFallback('url'),
        divider(),
        note(
          "This link expires in 1 hour and can be used once. If you didn't ask for this, you can ignore this email – your password stays the same.",
        ),
      ],
    }),
    compileEmail<'signInUrl' | 'forgotPasswordUrl'>({
      preview: 'This email address already has an account.',
      card: [
        heading('You already have an account'),
        paragraph(
          'Someone – hopefully you – tried to sign up with this email address, but it already has an account.',
        ),
        button('Sign in', 'signInUrl'),
        linkFallback('signInUrl'),
        divider(),
        note(
          "If you've forgotten your password, use [Forgot password](forgotPasswordUrl) on the sign-in page. If this wasn't you, you can ignore this email.",
        ),
      ],
    }),
    compileEmail<'customer' | 'total' | 'shop' | 'orderNumber' | 'orderUrl' | 'settingsUrl'>({
      preview: '{customer} confirmed an order for {total}.',
      card: [
        heading('New order from {customer}'),
        paragraph(
          '{customer} confirmed an order for {total} with the order assistant at {shop}. Check it and confirm it to start packing.',
        ),
        details([
          {
            label: 'Order',
            value: '{orderNumber}',
            mono: true,
            pill: { text: 'Drafted', tone: 'accent' },
          },
          { label: 'Customer', value: '{customer}' },
          { label: 'Total', value: '{total}', strong: true },
        ]),
        button('View the order', 'orderUrl'),
      ],
      footer: settingsFooter('New order drafted'),
    }),
    compileEmail<'customer' | 'shop' | 'minutes' | 'ago' | 'conversationUrl' | 'settingsUrl'>({
      preview: 'A chat was handed to you {ago} and nobody has replied yet.',
      card: [
        pill('Waiting {minutes} min', 'warning'),
        heading('{customer} is waiting for you'),
        paragraph(
          'The order assistant at {shop} handed a chat with {customer} to you {ago}, and nobody has replied yet.',
        ),
        button('Open the conversation', 'conversationUrl'),
      ],
      footer: settingsFooter('Customer waiting for you'),
    }),
    compileEmail<
      'shop' | 'date' | 'orderCount' | 'orders' | 'revenue' | 'ordersUrl' | 'settingsUrl'
    >({
      preview: '{orders} for {revenue} on {date}.',
      card: [
        heading('Yesterday at {shop}', { eyebrow: 'Daily summary · {date}', space: '24px' }),
        stats([
          { label: 'Orders', value: '{orderCount}' },
          { label: 'Revenue', value: '{revenue}' },
        ]),
        paragraph(
          '{shop} took {orders} on {date}, for {revenue} in revenue. Cancelled and returned orders are left out of both.',
        ),
        button('View your orders', 'ordersUrl'),
      ],
      footer: settingsFooter('Daily summary'),
    }),
  ]);

// ---------------------------------------------------------------------------
// Auth

export function verificationEmail(url: string): MailContent {
  const subject = 'Verify your email address';
  return {
    subject,
    text: `Welcome! Confirm your email address to finish setting up your account.

Verify email: ${url}

This link expires in 24 hours. If you didn't create an account, you can ignore this email.
`,
    html: verifyHtml({ subject, url }),
  };
}

export function resetPasswordEmail(url: string): MailContent {
  const subject = 'Reset your password';
  return {
    subject,
    text: `We received a request to reset the password for your account.

Choose a new password: ${url}

This link expires in 1 hour and can be used once. If you didn't ask for this, you can ignore this email – your password stays the same.
`,
    html: resetHtml({ subject, url }),
  };
}

export interface ExistingAccountEmail {
  signInUrl: string;
  forgotPasswordUrl: string;
}

/**
 * Sent instead of an error when someone signs up with an email that already
 * has an account. The API answers that sign-up exactly like a fresh one, so the
 * form never reveals which addresses are registered; this tells the real owner
 * where to go instead.
 */
export function existingAccountEmail({
  signInUrl,
  forgotPasswordUrl,
}: ExistingAccountEmail): MailContent {
  const subject = 'You already have an account';
  return {
    subject,
    text: `Someone – hopefully you – tried to sign up with this email address, but it already has an account.

Sign in: ${signInUrl}

If you've forgotten your password, use "Forgot password" on the sign-in page: ${forgotPasswordUrl}
If this wasn't you, you can ignore this email.
`,
    html: existingHtml({ subject, signInUrl, forgotPasswordUrl }),
  };
}

// ---------------------------------------------------------------------------
// Seller notifications

const settingsText = (setting: string, settingsUrl: string) =>
  `You get this email because "${setting}" is on in your notification settings. Change them: ${settingsUrl}`;

export interface NewOrderEmail {
  /** ORD-2026-00481 */
  orderNumber: string;
  customerName: string;
  shopName: string;
  /** Formatted for the shop, e.g. "৳ 3,260". */
  total: string;
  orderUrl: string;
  settingsUrl: string;
}

/** The order assistant drafted an order the customer confirmed; the seller confirms it next. */
export function newOrderEmail(order: NewOrderEmail): MailContent {
  const subject = `New order ${order.orderNumber}`;
  return {
    subject,
    text: `${order.customerName} confirmed an order for ${order.total} with the order assistant at ${order.shopName}. Check it and confirm it to start packing.

Order: ${order.orderNumber} (Drafted)
Customer: ${order.customerName}
Total: ${order.total}

View the order: ${order.orderUrl}

${settingsText('New order drafted', order.settingsUrl)}
`,
    html: newOrderHtml({
      subject,
      customer: order.customerName,
      total: order.total,
      shop: order.shopName,
      orderNumber: order.orderNumber,
      orderUrl: order.orderUrl,
      settingsUrl: order.settingsUrl,
    }),
  };
}

export interface CustomerWaitingEmail {
  customerName: string;
  shopName: string;
  /** Whole minutes since the assistant handed the chat off. */
  waitingMinutes: number;
  conversationUrl: string;
  settingsUrl: string;
}

/** The assistant handed a chat to the seller and nobody has replied. */
export function customerWaitingEmail(chat: CustomerWaitingEmail): MailContent {
  const subject = `${chat.customerName} is waiting for you`;
  const ago = `${plural(chat.waitingMinutes, 'minute', 'minutes')} ago`;
  return {
    subject,
    text: `The order assistant at ${chat.shopName} handed a chat with ${chat.customerName} to you ${ago}, and nobody has replied yet.

Open the conversation: ${chat.conversationUrl}

${settingsText('Customer waiting for you', chat.settingsUrl)}
`,
    html: waitingHtml({
      subject,
      customer: chat.customerName,
      shop: chat.shopName,
      minutes: count.format(chat.waitingMinutes),
      ago,
      conversationUrl: chat.conversationUrl,
      settingsUrl: chat.settingsUrl,
    }),
  };
}

export interface DailySummaryEmail {
  shopName: string;
  /** The day summarized, formatted for the shop, e.g. "6 Oct 2026". */
  date: string;
  /** Orders that day, cancelled and returned ones left out. */
  orderCount: number;
  /** Their revenue, formatted for the shop. */
  revenue: string;
  ordersUrl: string;
  settingsUrl: string;
}

/** Yesterday's orders and revenue for one shop. */
export function dailySummaryEmail(summary: DailySummaryEmail): MailContent {
  const orders = plural(summary.orderCount, 'order', 'orders');
  const subject = `${summary.shopName}: ${orders} on ${summary.date}`;
  return {
    subject,
    text: `Daily summary · ${summary.date}

${summary.shopName} took ${orders} on ${summary.date}, for ${summary.revenue} in revenue. Cancelled and returned orders are left out of both.

View your orders: ${summary.ordersUrl}

${settingsText('Daily summary', summary.settingsUrl)}
`,
    html: summaryHtml({
      subject,
      shop: summary.shopName,
      date: summary.date,
      orderCount: count.format(summary.orderCount),
      orders,
      revenue: summary.revenue,
      ordersUrl: summary.ordersUrl,
      settingsUrl: summary.settingsUrl,
    }),
  };
}
