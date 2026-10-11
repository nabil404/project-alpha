import { eq, sql } from 'drizzle-orm';
import * as schema from '../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedConversation, seedMessage } from '../../database/__tests__/conversation-seeds';
import { MessageRepository, SEND_LEASE_SECONDS } from '../message.repository';

describeDb('MessageRepository.claimForResend', () => {
  let t: CatalogTestDb;
  const messages = new MessageRepository();

  const reply = async (status: 'failed' | 'sending') => {
    const convo = await seedConversation(t.db, t.merchantA);
    return seedMessage(t.db, t.merchantA, convo.id, { sender: 'assistant', text: 'Ref', status });
  };
  const clock = async (executor: Pick<CatalogTestDb['db'], 'execute'>) => {
    const result = await executor.execute<{ at: string }>(sql`select clock_timestamp() as at`);
    return new Date(result.rows[0]!.at);
  };

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("never claims another merchant's reply, though the connection could see it", async () => {
    const row = await reply('failed');

    await expect(
      messages.claimForResend(t.db, { merchantId: t.merchantB }, row.id),
    ).resolves.toBeNull();
    const [after] = await t.db.select().from(schema.message).where(eq(schema.message.id, row.id));
    expect(after?.status).toBe('failed');
    await expect(
      messages.claimForResend(t.db, { merchantId: t.merchantA }, row.id),
    ).resolves.toMatchObject({ id: row.id, status: 'sending' });
  });

  it('starts the lease when the claim runs, not when its transaction began', async () => {
    const row = await reply('failed');
    const claimed = await t.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_sleep(0.3)`);
      const before = await clock(tx);
      const got = await messages.claimForResend(tx, { merchantId: t.merchantA }, row.id);
      return { got, before };
    });
    expect(claimed.got?.updatedAt.getTime()).toBeGreaterThanOrEqual(claimed.before.getTime());
  });

  it('measures an expired lease against the clock when the claim runs', async () => {
    const row = await reply('sending');
    const claimed = await t.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_sleep(0.3)`);
      await tx
        .update(schema.message)
        .set({
          updatedAt: sql`clock_timestamp() - make_interval(secs => ${SEND_LEASE_SECONDS + 0.15})`,
        })
        .where(eq(schema.message.id, row.id));
      return messages.claimForResend(tx, { merchantId: t.merchantA }, row.id);
    });
    expect(claimed?.id).toBe(row.id);
  });
});
