import { escapeHtml, type MailContent } from '../mail/templates';

/**
 * Seller notification bodies. Each says what happened, links to where to act
 * and, last, to Settings > Notifications, where the email can be turned off.
 * Plain text alongside HTML, as with the auth mail.
 */

interface NotificationParts {
  subject: string;
  lines: string[];
  action: string;
  url: string;
  /** The switch's name as Settings > Notifications shows it. */
  switchName: string;
  appUrl: string;
}

function notification({ subject, lines, action, url, switchName, appUrl }: NotificationParts) {
  const settingsUrl = `${appUrl}/settings/notifications`;
  const why = `You get this email because "${switchName}" is on in your notification settings.`;
  return {
    subject,
    text:
      [...lines, `${action}: ${url}`, `${why}\nChange them: ${settingsUrl}`].join('\n\n') + '\n',
    html: [
      ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
      `<p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p>`,
      `<p style="color:#5c5e63;font-size:13px">${escapeHtml(why)} <a href="${escapeHtml(settingsUrl)}">Change them</a>.</p>`,
    ].join('\n'),
  } satisfies MailContent;
}

export function orderDraftedEmail(input: {
  appUrl: string;
  shopName: string;
  orderId: string;
  reference: string;
  customerName: string | null;
  total: string;
}): MailContent {
  const who = input.customerName ?? 'A customer';
  return notification({
    subject: `New order ${input.reference}`,
    lines: [
      `${who} confirmed an order for ${input.total} with the order assistant at ${input.shopName}.`,
      `Check it and confirm it to start packing.`,
    ],
    action: 'View the order',
    url: `${input.appUrl}/orders/${encodeURIComponent(input.orderId)}`,
    switchName: 'New order drafted',
    appUrl: input.appUrl,
  });
}

export function customerWaitingEmail(input: {
  appUrl: string;
  shopName: string;
  conversationId: string;
  customerName: string | null;
  waitingMinutes: number;
}): MailContent {
  const who = input.customerName ?? 'A customer';
  return notification({
    subject: `${who} is waiting for you`,
    lines: [
      `The order assistant at ${input.shopName} handed a chat with ${who} to you ${input.waitingMinutes} minutes ago, and nobody has replied yet.`,
    ],
    action: 'Open the conversation',
    url: `${input.appUrl}/conversations/${encodeURIComponent(input.conversationId)}`,
    switchName: 'Customer waiting for you',
    appUrl: input.appUrl,
  });
}

export function dailySummaryEmail(input: {
  appUrl: string;
  shopName: string;
  /** The day summarised, in the shop's date format. */
  date: string;
  orders: number;
  revenue: string;
}): MailContent {
  const orders = input.orders === 1 ? '1 order' : `${input.orders} orders`;
  return notification({
    subject: `${input.shopName}: ${orders} on ${input.date}`,
    lines: [
      `${input.shopName} took ${orders} on ${input.date}, for ${input.revenue} in revenue.`,
      `Revenue leaves out cancelled and returned orders.`,
    ],
    action: 'View your orders',
    url: `${input.appUrl}/orders`,
    switchName: 'Daily summary',
    appUrl: input.appUrl,
  });
}
