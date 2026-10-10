import { checkReply, REPLY_MAX_GRAPHEMES } from '../reply-check';
import type { ReplyFacts } from '../reply-intent';

const facts: ReplyFacts = {
  items: [{ productName: 'Red saree', quantity: 2 }],
  customerName: 'Rahim',
  phone: '+8801812000000',
  deliveryAddress: 'House 12, Road 5, Dhanmondi',
};

describe('checkReply', () => {
  it('passes a reply that only repeats the facts', () => {
    expect(checkReply('Got it, 2 red sarees for Rahim at House 12, Road 5.', facts)).toEqual({
      ok: true,
    });
  });

  it('passes the quantity and address numbers in Bangla digits', () => {
    expect(checkReply('ঠিক আছে, ২টি শাড়ি, বাড়ি ১২, রোড ৫।', facts)).toEqual({ ok: true });
  });

  it('passes the phone in every common spelling', () => {
    for (const spelling of ['01812000000', '01812-000000', '+8801812000000', '+880 1812-000000']) {
      expect(checkReply(`We will call ${spelling}.`, facts)).toEqual({ ok: true });
    }
  });

  it('rejects an invented price or quantity, in Latin or Bangla digits', () => {
    expect(checkReply('That will be 1500 taka.', facts)).toEqual({ ok: false, reason: 'number' });
    expect(checkReply('দাম ১৫০০ টাকা।', facts)).toEqual({ ok: false, reason: 'number' });
    expect(checkReply('So 3 sarees then?', facts)).toEqual({ ok: false, reason: 'number' });
  });

  it('rejects a discount the facts do not hold', () => {
    expect(checkReply('Sure, you get 50% off today!', facts)).toEqual({
      ok: false,
      reason: 'number',
    });
  });

  it('rejects a price one unit off the catalog, and passes the formatted price and total', () => {
    const priced: ReplyFacts = {
      items: [
        { productName: 'Red saree', quantity: 2, unitPrice: '৳1,600.00', lineTotal: '৳3,200.00' },
      ],
      deliveryFee: '৳60.00',
      total: '৳3,260.00',
    };
    expect(checkReply('Red saree is ৳1,600 each, ৳3,260 in total with delivery.', priced)).toEqual({
      ok: true,
    });
    expect(checkReply('রেড শাড়ি ১,৬০০.০০৳, ডেলিভারি ৬০৳।', priced)).toEqual({ ok: true });
    expect(checkReply('Red saree is ৳1,601 each.', priced)).toEqual({
      ok: false,
      reason: 'number',
    });
    expect(checkReply('Red saree is ৳1,599 each.', priced)).toEqual({
      ok: false,
      reason: 'number',
    });
  });

  it('rejects links', () => {
    expect(checkReply('Order at https://example.org/x', facts)).toEqual({
      ok: false,
      reason: 'url',
    });
    expect(checkReply('See www.myshop.com', facts)).toEqual({ ok: false, reason: 'url' });
    expect(checkReply('Visit myshop.com.bd', facts)).toEqual({ ok: false, reason: 'url' });
  });

  it('rejects an empty or over-long reply', () => {
    expect(checkReply('   ', facts)).toEqual({ ok: false, reason: 'empty' });
    expect(checkReply('a'.repeat(REPLY_MAX_GRAPHEMES + 1), facts)).toEqual({
      ok: false,
      reason: 'too_long',
    });
    expect(checkReply('a'.repeat(REPLY_MAX_GRAPHEMES), facts)).toEqual({ ok: true });
  });
});
