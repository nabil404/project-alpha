import { parseInboundJobs } from '../webhook-payload';

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
});
