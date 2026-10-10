import { BUTTON_TEXT_MAX } from '../../../messenger/page/meta-graph.client';
import type { LineFacts, ReplyFacts } from '../reply-intent';
import { summaryMessages } from '../summary-card';

const line = (n: number): LineFacts => ({
  productName: `Jamdani Saree ${n}`,
  variantName: 'Red',
  quantity: 2,
  lineTotal: '৳2,200.00',
});
const facts = (items: LineFacts[]): ReplyFacts => ({
  items,
  customerName: 'Rahim',
  phone: '+8801812000000',
  deliveryAddress: 'House 12, Road 5, Dhanmondi, Dhaka',
  areaName: 'Dhaka',
  subtotal: '৳4,400.00',
  deliveryFee: '৳60.00',
  total: '৳4,460.00',
});
const length = (text: string) => Array.from(text).length;

describe('summaryMessages', () => {
  it('fills the card from the facts, one line per item, with both buttons', () => {
    const { items, card, buttons } = summaryMessages(facts([line(1), line(2)]), 'en');
    expect(items).toBeNull();
    expect(card).toBe(
      [
        'Your order:',
        '2 × Jamdani Saree 1, Red  ৳2,200.00',
        '2 × Jamdani Saree 2, Red  ৳2,200.00',
        '',
        'Subtotal: ৳4,400.00',
        'Delivery (Dhaka): ৳60.00',
        'Total: ৳4,460.00',
        '',
        'Name: Rahim',
        'Phone: +880 1812 000000',
        'Address: House 12, Road 5, Dhanmondi, Dhaka',
        '',
        'Tap Confirm to place the order.',
      ].join('\n'),
    );
    expect(buttons).toEqual({ confirm: 'Confirm', change: 'Change something' });
  });

  it('has the same parts in Bangla', () => {
    const { card, buttons } = summaryMessages(facts([line(1)]), 'bn');
    expect(card).toContain('ডেলিভারি চার্জ (Dhaka): ৳60.00');
    expect(card).toContain('সর্বমোট: ৳4,460.00');
    expect(buttons.confirm).toBe('নিশ্চিত করুন');
  });

  it('puts a notice first', () => {
    const { card } = summaryMessages(facts([line(1)]), 'en', 'The price changed.');
    expect(card.startsWith('The price changed.\n\nYour order:')).toBe(true);
  });

  it('sends the item lines on their own when the card would pass the limit', () => {
    const many = facts(
      Array.from({ length: 10 }, (_, n) => ({
        ...line(n + 1),
        productName: `Jamdani Saree with a golden border ${n + 1}`,
      })),
    );
    const { items, card } = summaryMessages(many, 'en');
    expect(items).not.toBeNull();
    expect(items!.split('\n')).toHaveLength(11);
    expect(card.startsWith('Subtotal:')).toBe(true);
    expect(card).toContain('Address: House 12');
    expect(length(card)).toBeLessThanOrEqual(BUTTON_TEXT_MAX);
  });
});
