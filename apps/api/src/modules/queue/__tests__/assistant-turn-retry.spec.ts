import { Backoffs } from 'bullmq';
import { SEND_LEASE_SECONDS } from '../../conversations/message.repository';
import { ASSISTANT_TURN_RETRY } from '../queue.constants';

describe('ASSISTANT_TURN_RETRY', () => {
  it("outlasts a send lease taken by any attempt but the last, so a blocked Confirm's reference still goes out", async () => {
    const { attempts, backoff } = ASSISTANT_TURN_RETRY;
    for (let died = 1; died < attempts; died += 1) {
      let waited = 0;
      for (let made = died; made < attempts; made += 1) {
        waited += (await Backoffs.calculate(
          { ...backoff },
          made,
          new Error('lease'),
          undefined as never,
        ))!;
      }
      expect(waited).toBeGreaterThan(SEND_LEASE_SECONDS * 1_000);
    }
  });
});
