import { randomUUID } from 'node:crypto';
import { CONVERSATION_EVENTS_CHANNEL } from '../conversation-event';
import { publisherConnection, redisSubscribe } from '../redis-connections';

const url = process.env.REDIS_URL;
const describeRedis = url ? describe : describe.skip;

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describeRedis('conversation events over a real Redis', () => {
  it('delivers what the publisher connection sends to a subscriber', async () => {
    const received: string[] = [];
    const subscription = await redisSubscribe(url!)((message) => received.push(message));
    const publisher = publisherConnection(url!);
    try {
      const payload = JSON.stringify({
        merchantId: 'm',
        conversationId: randomUUID(),
        kind: 'message',
      });
      await publisher.publish(CONVERSATION_EVENTS_CHANNEL, payload);

      await waitFor(() => received.length > 0);
      expect(received).toEqual([payload]);
    } finally {
      publisher.disconnect();
      await subscription.close();
    }
  });
});
