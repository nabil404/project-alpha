import type { MessageRow } from '../../database/schema/index';
import { toMessage } from '../conversation-mappers';

const photoUrl = (key: string) => `https://media.example.test/${key}`;
const row = (details: unknown): MessageRow =>
  ({
    id: 'm1',
    sender: 'customer',
    kind: 'image',
    text: '',
    details,
    editedText: null,
    deletedAt: null,
    status: 'sent',
    sentAt: new Date('2026-10-17T10:00:00Z'),
  }) as MessageRow;

describe('toMessage', () => {
  it("shows a copied photo from our bucket, and one not copied from Meta's link", () => {
    const message = toMessage(
      row({
        attachments: [
          { url: 'https://scontent.xx.fbcdn.net/a.jpg', key: 'c/org/m1-0.jpg' },
          { url: 'https://scontent.xx.fbcdn.net/b.jpg', failed: 'too_large' },
          { url: 'http://insecure.example/c.jpg' },
        ],
      }),
      photoUrl,
    );
    expect(message.attachments).toEqual([
      { url: 'https://media.example.test/c/org/m1-0.jpg' },
      { url: 'https://scontent.xx.fbcdn.net/b.jpg' },
      { url: null },
    ]);
  });
});
