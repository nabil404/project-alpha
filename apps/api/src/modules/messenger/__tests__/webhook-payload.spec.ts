import { parseInboundJobs } from '../webhook-payload.js';

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
              timestamp: 1700000000000,
              message: { mid: 'mid-1', text: 'do you have the blue one?' },
            },
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      {
        messageId: 'mid-1',
        pageId: 'page-1',
        senderPsid: 'psid-1',
        text: 'do you have the blue one?',
        sentAt: 1700000000000,
      },
    ]);
  });

  it('ignores seller echoes, deliveries, and non-page objects', () => {
    expect(
      parseInboundJobs({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [
              { sender: { id: 'psid-1' }, message: { mid: 'mid-2', text: 'hi', is_echo: true } },
              { sender: { id: 'psid-1' } },
            ],
          },
        ],
      }),
    ).toEqual([]);

    expect(parseInboundJobs({ object: 'instagram', entry: [] })).toEqual([]);
  });
});
