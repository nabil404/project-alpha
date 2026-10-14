import {
  parseAttachments,
  parseInboundJobs,
  parseReferral,
  type MetaWebhookBody,
} from '../webhook-payload';

type RawEvent = NonNullable<NonNullable<MetaWebhookBody['entry']>[number]['messaging']>[number];
const one = (event: RawEvent) =>
  parseInboundJobs({
    object: 'page',
    entry: [
      {
        id: 'page-1',
        messaging: [
          {
            sender: { id: 'psid-1' },
            recipient: { id: 'page-1' },
            timestamp: 1700000000000,
            ...event,
          },
        ],
      },
    ],
  });

describe('non-text events', () => {
  it('maps a sticker, a location and a video to a message with no words', () => {
    expect(
      one({
        message: {
          mid: 'mid-s',
          sticker_id: 369239263222822,
          attachments: [
            { type: 'image', payload: { url: 'https://cdn/s.png', sticker_id: 369239263222822 } },
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: 'customer-message',
        messageId: 'mid-s',
        text: '',
        attachments: [{ type: 'sticker', url: 'https://cdn/s.png', stickerId: '369239263222822' }],
      }),
    ]);
    expect(
      parseAttachments({
        attachments: [
          { type: 'location', payload: { coordinates: { lat: 23.8, long: 90.4 } } },
          { type: 'video', payload: { url: 'https://cdn/v.mp4' } },
          { type: 'reel', payload: { url: 'https://cdn/r' } },
        ],
      }),
    ).toEqual([
      { type: 'location', lat: 23.8, long: 90.4 },
      { type: 'video', url: 'https://cdn/v.mp4' },
      { type: 'other', url: 'https://cdn/r' },
    ]);
  });

  it('still drops a message with neither words nor attachments', () => {
    expect(one({ message: { mid: 'mid-empty' } })).toEqual([]);
  });

  it('keys a reaction by the event, so a redelivery repeats the id and a new one does not', () => {
    const reaction = { mid: 'mid-card', action: 'react', emoji: '❤️', reaction: 'love' };
    const [first] = one({ reaction });
    const [again] = one({ reaction });
    const [later] = one({ reaction, timestamp: 1700000009999 });
    expect(first).toMatchObject({
      kind: 'customer-reaction',
      targetMid: 'mid-card',
      action: 'react',
      emoji: '❤️',
    });
    expect(first?.messageId).toMatch(/^rx-/);
    expect(again?.messageId).toBe(first?.messageId);
    expect(later?.messageId).not.toBe(first?.messageId);
  });

  it('keys an edit apart from the message it edits', () => {
    const [job] = one({ message_edit: { mid: 'mid-1', text: 'blue saree', num_edit: 1 } });
    expect(job).toMatchObject({ kind: 'customer-edit', targetMid: 'mid-1', text: 'blue saree' });
    expect(job?.messageId).not.toBe('mid-1');
    expect(job?.messageId).toMatch(/^ed-/);
  });

  it('maps an unsend to its own key', () => {
    expect(one({ message: { mid: 'mid-1', is_deleted: true } })).toEqual([
      expect.objectContaining({
        kind: 'customer-unsend',
        messageId: 'un-mid-1',
        targetMid: 'mid-1',
      }),
    ]);
  });

  it('ignores the Page’s own reactions and edits', () => {
    expect(
      one({ sender: { id: 'page-1' }, reaction: { mid: 'm', action: 'react', emoji: '👍' } }),
    ).toEqual([]);
  });
});

describe('parseInboundJobs', () => {
  it('maps a customer message to a job keyed by the Meta message ID', () => {
    const jobs = parseInboundJobs({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'page-1' },
              timestamp: 1700000000000,
              message: { mid: 'mid-1', text: 'do you have the blue one?' },
            },
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      {
        kind: 'customer-message',
        messageId: 'mid-1',
        pageId: 'page-1',
        senderPsid: 'psid-1',
        text: 'do you have the blue one?',
        sentAt: 1700000000000,
      },
    ]);
  });

  it('maps an echo to a Page-echo job for the customer it was sent to, keeping the sending app', () => {
    const jobs = parseInboundJobs({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'page-1' },
              recipient: { id: 'psid-1' },
              timestamp: 1700000000500,
              message: {
                mid: 'mid-2',
                text: 'Yes, in stock',
                is_echo: true,
                app_id: 263902037430900,
              },
            },
            {
              sender: { id: 'page-1' },
              recipient: { id: 'psid-1' },
              timestamp: 1700000000600,
              message: { mid: 'mid-3', text: 'Sent from the Page inbox', is_echo: true },
            },
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      {
        kind: 'page-echo',
        messageId: 'mid-2',
        pageId: 'page-1',
        recipientPsid: 'psid-1',
        text: 'Yes, in stock',
        sentAt: 1700000000500,
        appId: '263902037430900',
      },
      {
        kind: 'page-echo',
        messageId: 'mid-3',
        pageId: 'page-1',
        recipientPsid: 'psid-1',
        text: 'Sent from the Page inbox',
        sentAt: 1700000000600,
      },
    ]);
  });

  it('ignores attachments, deliveries, events without a party, and non-page objects', () => {
    expect(
      parseInboundJobs({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [
              { sender: { id: 'psid-1' }, message: { mid: 'mid-4' } },
              { sender: { id: 'psid-1' } },
              { message: { mid: 'mid-5', text: 'no sender' } },
              {
                sender: { id: 'page-1' },
                message: { mid: 'mid-6', text: 'echo, no recipient', is_echo: true },
              },
            ],
          },
          { messaging: [{ sender: { id: 'psid-1' }, message: { mid: 'mid-7', text: 'no page' } }] },
        ],
      }),
    ).toEqual([]);

    expect(parseInboundJobs({ object: 'instagram', entry: [] })).toEqual([]);
  });

  it('maps a quick-reply tap to a customer message carrying its payload', () => {
    const jobs = parseInboundJobs({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'page-1' },
              timestamp: 1700000001000,
              message: {
                mid: 'mid-q',
                text: 'Red saree',
                quick_reply: { payload: 'pick:product:abc' },
              },
            },
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      {
        kind: 'customer-message',
        messageId: 'mid-q',
        pageId: 'page-1',
        senderPsid: 'psid-1',
        text: 'Red saree',
        sentAt: 1700000001000,
        payload: 'pick:product:abc',
      },
    ]);
  });

  it('maps a button tap to a postback job titled as the button', () => {
    const event = {
      sender: { id: 'psid-1' },
      recipient: { id: 'page-1' },
      timestamp: 1700000002000,
      postback: { mid: 'mid-pb', title: 'Confirm', payload: 'confirm:c:1' },
    };
    const jobs = parseInboundJobs({
      object: 'page',
      entry: [{ id: 'page-1', messaging: [event] }],
    });

    expect(jobs).toEqual([
      {
        kind: 'customer-postback',
        messageId: 'mid-pb',
        pageId: 'page-1',
        senderPsid: 'psid-1',
        text: 'Confirm',
        payload: 'confirm:c:1',
        sentAt: 1700000002000,
      },
    ]);
  });

  it('derives a stable id for a postback Meta sent without a mid', () => {
    const event = {
      sender: { id: 'psid-1' },
      recipient: { id: 'page-1' },
      timestamp: 1700000003000,
      postback: { title: 'Confirm', payload: 'confirm:c:1' },
    };
    const body = { object: 'page', entry: [{ id: 'page-1', messaging: [event] }] };
    const [first] = parseInboundJobs(body);
    const [again] = parseInboundJobs(body);
    const [other] = parseInboundJobs({
      object: 'page',
      entry: [{ id: 'page-1', messaging: [{ ...event, timestamp: 1700000004000 }] }],
    });

    expect(first?.messageId).toMatch(/^pb-[0-9a-f]{64}$/);
    expect(again?.messageId).toBe(first?.messageId);
    expect(other?.messageId).not.toBe(first?.messageId);
  });

  it('drops a postback with no payload', () => {
    expect(
      parseInboundJobs({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [{ sender: { id: 'psid-1' }, postback: { title: 'Get Started' } }],
          },
        ],
      }),
    ).toEqual([]);
  });
});

const PRODUCT = '8f3c2a1e-0000-4000-8000-000000000001';
const page = (messaging: unknown[]) => ({ object: 'page', entry: [{ id: 'page-1', messaging }] });

describe('referrals', () => {
  it('reads a product link from a new chat’s first message', () => {
    const [job] = parseInboundJobs(
      page([
        {
          sender: { id: 'psid-1' },
          timestamp: 1,
          message: {
            mid: 'mid-1',
            text: 'hi',
            referral: { ref: `p_${PRODUCT}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
          },
        },
      ]) as never,
    );
    expect(job).toMatchObject({
      kind: 'customer-message',
      referral: { kind: 'link', productId: PRODUCT },
    });
  });

  it('reads an ad from Get Started', () => {
    const [job] = parseInboundJobs(
      page([
        {
          sender: { id: 'psid-1' },
          timestamp: 2,
          postback: {
            title: 'Get Started',
            payload: 'start',
            referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '1202' },
          },
        },
      ]) as never,
    );
    expect(job).toMatchObject({
      kind: 'customer-postback',
      payload: 'start',
      referral: { kind: 'ad', adId: '1202' },
    });
  });

  it('turns a standalone referral into a job whose id survives redelivery', () => {
    const event = {
      sender: { id: 'psid-1' },
      timestamp: 3,
      referral: { ref: `p_${PRODUCT}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
    };
    const [first] = parseInboundJobs(page([event]) as never);
    const [again] = parseInboundJobs(page([event]) as never);
    expect(first).toMatchObject({
      kind: 'customer-referral',
      senderPsid: 'psid-1',
      referral: { kind: 'link', productId: PRODUCT },
    });
    expect(first?.messageId).toMatch(/^rf-[0-9a-f]{64}$/);
    expect(again?.messageId).toBe(first?.messageId);
  });

  it.each([
    [{ ref: 'summer-sale', source: 'SHORTLINK' }],
    [{ ref: `p_${PRODUCT}x`, source: 'SHORTLINK' }],
    [{ source: 'ADS' }],
    [{ source: 'ADS', ad_id: '' }],
  ])('treats %j as organic', (raw) => {
    expect(parseReferral(raw)).toBeNull();
  });

  it('drops a standalone referral that names nothing we use', () => {
    expect(
      parseInboundJobs(
        page([{ sender: { id: 'psid-1' }, timestamp: 4, referral: { ref: 'promo' } }]) as never,
      ),
    ).toEqual([]);
  });
});
