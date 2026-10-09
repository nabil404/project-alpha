import { eq } from 'drizzle-orm';
import * as schema from '../../../database/schema/index';
import { LLM_CALL_OUTCOMES, LLM_CALL_PURPOSES } from '../../../database/schema/assistant';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import { seedConversation } from '../../../database/__tests__/conversation-seeds';
import { withMerchant } from '../../../database/with-merchant';
import { LLM_OUTCOMES, LLM_PURPOSES, type LlmCallRecord } from '../../../llm/llm.types';
import { LlmCallRepository } from '../llm-call.repository';

const call = (overrides: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
  purpose: 'classify',
  model: 'gpt-test',
  inputTokens: 120,
  outputTokens: 9,
  latencyMs: 340,
  outcome: 'ok',
  ...overrides,
});

it('keeps the schema literals equal to the LLM types', () => {
  expect([...LLM_CALL_PURPOSES]).toEqual([...LLM_PURPOSES]);
  expect([...LLM_CALL_OUTCOMES]).toEqual([...LLM_OUTCOMES]);
});

describeDb('LlmCallRepository (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  const repo = new LlmCallRepository();

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it("writes a turn's calls, failures with null tokens included", async () => {
    const convo = await seedConversation(t.db, t.merchantA);

    await withMerchant(runtime.db, t.merchantA, (tx) =>
      repo.insertMany(tx, { merchantId: t.merchantA }, convo.id, [
        call(),
        call({ purpose: 'phrase', outcome: 'timeout', inputTokens: null, outputTokens: null }),
      ]),
    );

    const rows = await t.db
      .select()
      .from(schema.llmCall)
      .where(eq(schema.llmCall.conversationId, convo.id));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ merchantId: t.merchantA, purpose: 'classify', inputTokens: 120 }),
        expect.objectContaining({ purpose: 'phrase', outcome: 'timeout', inputTokens: null }),
      ]),
    );
  });

  it('writes nothing for an empty list', async () => {
    const convo = await seedConversation(t.db, t.merchantA);
    await withMerchant(runtime.db, t.merchantA, (tx) =>
      repo.insertMany(tx, { merchantId: t.merchantA }, convo.id, []),
    );
    expect(
      await t.db.select().from(schema.llmCall).where(eq(schema.llmCall.conversationId, convo.id)),
    ).toEqual([]);
  });

  it("never lets one merchant see or write another's calls", async () => {
    const convoA = await seedConversation(t.db, t.merchantA);
    await withMerchant(runtime.db, t.merchantA, (tx) =>
      repo.insertMany(tx, { merchantId: t.merchantA }, convoA.id, [call()]),
    );

    const seenByB = await withMerchant(runtime.db, t.merchantB, (tx) =>
      tx.select().from(schema.llmCall).where(eq(schema.llmCall.conversationId, convoA.id)),
    );
    expect(seenByB).toEqual([]);

    // B's context, B's scope, A's conversation: no such (merchant, conversation)
    // pair, so the composite foreign key refuses it.
    await expect(
      withMerchant(runtime.db, t.merchantB, (tx) =>
        repo.insertMany(tx, { merchantId: t.merchantB }, convoA.id, [call()]),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'llm_call_conversation_fk' } });

    // The foreign key is valid here (B's own conversation), so only the policy's
    // WITH CHECK can refuse a scope that differs from the context.
    const convoB = await seedConversation(t.db, t.merchantB);
    await expect(
      withMerchant(runtime.db, t.merchantA, (tx) =>
        repo.insertMany(tx, { merchantId: t.merchantB }, convoB.id, [call()]),
      ),
    ).rejects.toMatchObject({
      cause: { code: '42501', message: expect.stringMatching(/row-level security/) },
    });
  });
});
