import { sql } from 'drizzle-orm';
import { conversationStates, messageSenders, messageStatuses } from '@app/shared';
import * as schema from '../schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  pgErrorOf,
  type CatalogTestDb,
} from './catalog-test-db';
import {
  randomPageId,
  seedConversation,
  seedCustomer,
  seedFacebookPage,
  seedMessage,
} from './conversation-seeds';

describe('conversation enum columns', () => {
  it('match the shared enums', () => {
    expect(schema.conversation.state.enumValues).toEqual([...conversationStates]);
    expect(schema.conversation.lastMessageSender.enumValues).toEqual([...messageSenders]);
    expect(schema.message.sender.enumValues).toEqual([...messageSenders]);
    expect(schema.message.status.enumValues).toEqual([...messageStatuses]);
  });
});

describeDb('conversation schema constraints', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it("rejects a conversation on another merchant's customer", async () => {
    const customerOfA = await seedCustomer(t.db, t.merchantA);
    await expect(
      pgErrorOf(seedConversation(t.db, t.merchantB, { customerId: customerOfA.id })),
    ).resolves.toEqual({ code: '23503', constraint: 'conversation_customer_fk' });
  });

  it('holds one customer per psid per merchant, and the same psid in two shops', async () => {
    const first = await seedCustomer(t.db, t.merchantA, { psid: 'psid-shared' });
    await expect(
      pgErrorOf(seedCustomer(t.db, t.merchantA, { psid: 'psid-shared' })),
    ).resolves.toEqual({ code: '23505', constraint: schema.CUSTOMER_PSID_UQ });
    const other = await seedCustomer(t.db, t.merchantB, { psid: 'psid-shared' });
    expect(other.id).not.toBe(first.id);
  });

  it('stores a Meta message id once per merchant, while unsent replies never collide', async () => {
    const convo = await seedConversation(t.db, t.merchantA);
    await seedMessage(t.db, t.merchantA, convo.id, { metaMessageId: 'mid-dup' });
    await expect(
      pgErrorOf(seedMessage(t.db, t.merchantA, convo.id, { metaMessageId: 'mid-dup' })),
    ).resolves.toEqual({ code: '23505', constraint: schema.MESSAGE_META_ID_UQ });

    await seedMessage(t.db, t.merchantA, convo.id, {
      metaMessageId: null,
      status: 'sending',
      sender: 'seller',
    });
    await seedMessage(t.db, t.merchantA, convo.id, {
      metaMessageId: null,
      status: 'sending',
      sender: 'seller',
    });
  });

  it('resolves a Page to its merchant for the runtime role, without merchant context', async () => {
    const page = await seedFacebookPage(t.db, t.merchantA);

    const known = await runtime.db.execute<{ merchant_id: string | null }>(
      sql`select app_page_merchant(${page.pageId}) as merchant_id`,
    );
    expect(known.rows).toEqual([{ merchant_id: t.merchantA }]);

    const unknown = await runtime.db.execute<{ merchant_id: string | null }>(
      sql`select app_page_merchant(${randomPageId()}) as merchant_id`,
    );
    expect(unknown.rows).toEqual([{ merchant_id: null }]);

    // The function is the only way in: the table itself still shows nothing without context.
    await expect(runtime.db.select().from(schema.facebookPage)).resolves.toEqual([]);
  });

  it('hides one merchant’s conversations and messages from the other', async () => {
    const convo = await seedConversation(t.db, t.merchantA);
    await seedMessage(t.db, t.merchantA, convo.id);

    const seenByB = await runtime.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_merchant', ${t.merchantB}, true)`);
      return {
        conversations: await tx.select().from(schema.conversation),
        messages: await tx.select().from(schema.message),
        customers: await tx.select().from(schema.customer),
      };
    });
    expect(seenByB.conversations.some((row) => row.id === convo.id)).toBe(false);
    expect(seenByB.messages.some((row) => row.conversationId === convo.id)).toBe(false);
    expect(seenByB.customers.some((row) => row.id === convo.customerId)).toBe(false);
  });
});
