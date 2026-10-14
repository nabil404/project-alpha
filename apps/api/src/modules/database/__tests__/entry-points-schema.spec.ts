import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { entrySources } from '@app/shared';
import * as schema from '../schema/index';
import { describeDb, openCatalogTestDb, pgErrorOf, type CatalogTestDb } from './catalog-test-db';
import {
  randomPageId,
  seedConversation,
  seedCustomer,
  seedFacebookPage,
} from './conversation-seeds';

describeDb('entry points schema', () => {
  let t: CatalogTestDb;
  beforeAll(async () => {
    t = await openCatalogTestDb();
  });
  afterAll(() => t.close());

  it('keeps the literal entry sources equal to @app/shared', () => {
    expect(schema.conversation.entrySource.enumValues).toEqual([...entrySources]);
    expect(schema.order.entrySource.enumValues).toEqual([...entrySources]);
  });

  it('keeps one ad row per shop and ad id', async () => {
    const row = { merchantId: t.merchantA, pageId: randomPageId(), adId: `ad-${randomUUID()}` };
    await t.db.insert(schema.adProduct).values(row);
    const error = await pgErrorOf(t.db.insert(schema.adProduct).values(row));
    expect(error.constraint).toBe('ad_product_merchant_ad_uq');
  });

  it('refuses an entry source outside the list', async () => {
    const page = await seedFacebookPage(t.db, t.merchantA);
    const customer = await seedCustomer(t.db, t.merchantA);
    const conversation = await seedConversation(t.db, t.merchantA, {
      facebookPageId: page.pageId,
      customerId: customer.id,
    });
    expect(conversation.entrySource).toBe('organic');
    const error = await pgErrorOf(
      t.db
        .update(schema.conversation)
        .set({ entrySource: 'billboard' as never })
        .where(eq(schema.conversation.id, conversation.id)),
    );
    expect(error.constraint).toBe('conversation_entry_source_ck');
  });
});
