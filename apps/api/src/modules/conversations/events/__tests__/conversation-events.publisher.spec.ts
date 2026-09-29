import { Logger } from '@nestjs/common';
import { CONVERSATION_EVENTS_CHANNEL } from '../conversation-event';
import { ConversationEventsPublisher } from '../conversation-events.publisher';
import type { RedisPublisher } from '../redis-connections';

const event = {
  merchantId: 'merchant-a',
  conversationId: '6f1c2b1e-4a53-4d4e-9d7a-1b2c3d4e5f60',
  kind: 'message' as const,
};

describe('ConversationEventsPublisher', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('publishes the event as JSON on the conversation channel', async () => {
    const published: [string, string][] = [];
    const redis = {
      publish: async (channel: string, message: string) => {
        published.push([channel, message]);
        return 1;
      },
      disconnect: () => undefined,
    } as unknown as RedisPublisher;

    await new ConversationEventsPublisher(redis).publish(event);

    expect(published).toEqual([[CONVERSATION_EVENTS_CHANNEL, JSON.stringify(event)]]);
  });

  it('never fails its caller: the data is already committed', async () => {
    const redis = {
      publish: async () => {
        throw new Error('Connection is closed.');
      },
      disconnect: () => undefined,
    } as unknown as RedisPublisher;

    await expect(new ConversationEventsPublisher(redis).publish(event)).resolves.toBeUndefined();
  });
});
