import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
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

describe('redisSubscribe against a server that drops every connection', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('rejects, and leaves no client behind reconnecting in the background', async () => {
    let attempts = 0;
    const server = createServer((socket) => {
      attempts++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(redisSubscribe(`redis://127.0.0.1:${port}`)(() => undefined)).rejects.toThrow();

      // ioredis' first retry comes after 50ms: a client that was not
      // disconnected would have dialled the server again by now.
      const attemptsAtRejection = attempts;
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(attempts).toBe(attemptsAtRejection);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
