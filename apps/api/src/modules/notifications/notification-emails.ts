import {
  customerWaitingEmail as customerWaitingTemplate,
  dailySummaryEmail as dailySummaryTemplate,
  newOrderEmail,
  type MailContent,
} from '../mail/templates';

/**
 * Seller notification emails, from what the composer knows to the MJML
 * templates in `mail/templates.ts`. Each links to where to act and, last, to
 * Settings > Notifications, where the email can be turned off.
 */

const settingsUrl = (appUrl: string) => `${appUrl}/settings/notifications`;

export function orderDraftedEmail(input: {
  appUrl: string;
  shopName: string;
  orderId: string;
  reference: string;
  customerName: string | null;
  total: string;
}): MailContent {
  return newOrderEmail({
    orderNumber: input.reference,
    customerName: input.customerName ?? 'A customer',
    shopName: input.shopName,
    total: input.total,
    orderUrl: `${input.appUrl}/orders/${encodeURIComponent(input.orderId)}`,
    settingsUrl: settingsUrl(input.appUrl),
  });
}

export function customerWaitingEmail(input: {
  appUrl: string;
  shopName: string;
  conversationId: string;
  customerName: string | null;
  waitingMinutes: number;
}): MailContent {
  return customerWaitingTemplate({
    customerName: input.customerName ?? 'A customer',
    shopName: input.shopName,
    waitingMinutes: input.waitingMinutes,
    conversationUrl: `${input.appUrl}/conversations/${encodeURIComponent(input.conversationId)}`,
    settingsUrl: settingsUrl(input.appUrl),
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
  return dailySummaryTemplate({
    shopName: input.shopName,
    date: input.date,
    orderCount: input.orders,
    revenue: input.revenue,
    ordersUrl: `${input.appUrl}/orders`,
    settingsUrl: settingsUrl(input.appUrl),
  });
}
