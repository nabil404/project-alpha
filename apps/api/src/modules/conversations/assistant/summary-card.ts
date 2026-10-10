import { formatPhoneInternational } from '@app/shared';
import { BUTTON_TEXT_MAX } from '../../messenger/page/meta-graph.client';
import type { ReplyLanguage } from './assistant-fallbacks';
import type { ReplyFacts } from './reply-intent';

/** The summary as it goes out: the item lines on their own when the card would be too long. */
export interface SummaryMessages {
  /** Sent first as plain text, or null when the card holds the items too. */
  items: string | null;
  card: string;
  buttons: { confirm: string; change: string };
}

interface Labels {
  heading: string;
  subtotal: string;
  delivery: (area: string | undefined) => string;
  total: string;
  name: string;
  phone: string;
  address: string;
  prompt: string;
  confirm: string;
  change: string;
}

const LABELS: Record<ReplyLanguage, Labels> = {
  // Draft: to be reviewed by a Bangla speaker before any pilot.
  bn: {
    heading: 'আপনার অর্ডার:',
    subtotal: 'মোট পণ্যমূল্য',
    delivery: (area) => (area ? `ডেলিভারি চার্জ (${area})` : 'ডেলিভারি চার্জ'),
    total: 'সর্বমোট',
    name: 'নাম',
    phone: 'ফোন',
    address: 'ঠিকানা',
    prompt: 'সব ঠিক থাকলে "নিশ্চিত করুন" চাপুন।',
    confirm: 'নিশ্চিত করুন',
    change: 'কিছু বদলান',
  },
  en: {
    heading: 'Your order:',
    subtotal: 'Subtotal',
    delivery: (area) => (area ? `Delivery (${area})` : 'Delivery'),
    total: 'Total',
    name: 'Name',
    phone: 'Phone',
    address: 'Address',
    prompt: 'Tap Confirm to place the order.',
    confirm: 'Confirm',
    change: 'Change something',
  },
};

const length = (text: string) => Array.from(text).length;

/**
 * The summary card's text, filled by code from the facts: no LLM writes it,
 * so no number on it can be invented. Messenger caps a button template's text
 * at 640 characters; past that the item lines go out first as their own
 * message and the card keeps the totals and the customer's details.
 * `notice` is a fixed line put first, such as "the price changed".
 */
export function summaryMessages(
  facts: ReplyFacts,
  language: ReplyLanguage,
  notice?: string,
): SummaryMessages {
  const labels = LABELS[language];
  const lines = facts.items.map((item) => {
    const name = item.variantName ? `${item.productName}, ${item.variantName}` : item.productName;
    return `${item.quantity ?? ''} × ${name}  ${item.lineTotal ?? ''}`;
  });
  const totals = [
    `${labels.subtotal}: ${facts.subtotal ?? ''}`,
    `${labels.delivery(facts.areaName)}: ${facts.deliveryFee ?? ''}`,
    `${labels.total}: ${facts.total ?? ''}`,
    '',
    `${labels.name}: ${facts.customerName ?? ''}`,
    `${labels.phone}: ${facts.phone === undefined ? '' : formatPhoneInternational(facts.phone)}`,
    `${labels.address}: ${facts.deliveryAddress ?? ''}`,
    '',
    labels.prompt,
  ];
  const head = notice ? [notice, ''] : [];
  const buttons = { confirm: labels.confirm, change: labels.change };
  const whole = [...head, labels.heading, ...lines, '', ...totals].join('\n');
  if (length(whole) <= BUTTON_TEXT_MAX) return { items: null, card: whole, buttons };
  return {
    items: [...head, labels.heading, ...lines].join('\n'),
    card: totals.join('\n'),
    buttons,
  };
}
