import { getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MESSENGER_PROFILE_QUEUE } from '../queue.constants';

/** Stands in for a BullMQ queue, so an HTTP spec needs no Redis. */
export class FakeQueue {
  added: { name: string; data: unknown }[] = [];
  async add(name: string, data: unknown) {
    this.added.push({ name, data });
  }
}

/** The Messenger Profile queue, faked; use with `.overrideModule(QueueModule).useModule(...)`. */
export const fakeMessengerProfileQueue = new FakeQueue();

@Module({
  providers: [
    { provide: getQueueToken(MESSENGER_PROFILE_QUEUE), useValue: fakeMessengerProfileQueue },
  ],
  exports: [getQueueToken(MESSENGER_PROFILE_QUEUE)],
})
export class FakeQueueModule {}
