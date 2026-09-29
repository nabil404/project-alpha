import { randomInt, randomUUID } from 'node:crypto';
import type { Database } from '../database.module';
import * as schema from '../schema/index';

/** Facebook Page ids are numeric strings. */
export const randomPageId = (): string => `${randomInt(1e9, 1e10)}${randomInt(1e5, 1e6)}`;

/** A connected Page. `accessToken` must be CryptoService ciphertext when a test decrypts it. */
export async function seedFacebookPage(
  db: Database,
  merchantId: string,
  overrides: Partial<typeof schema.facebookPage.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.facebookPage)
    .values({
      merchantId,
      pageId: randomPageId(),
      name: "Rahim's Kitchen",
      accessToken: 'not-a-real-ciphertext',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seedFacebookPage returned no row');
  return row;
}

export const SEED_PICTURE_URL = 'https://platform-lookaside.fbsbx.com/pic?psid=seed';

export async function seedCustomer(
  db: Database,
  merchantId: string,
  overrides: Partial<typeof schema.customer.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.customer)
    .values({
      merchantId,
      psid: `psid-${randomUUID()}`,
      name: 'Nusrat Jahan',
      pictureUrl: SEED_PICTURE_URL,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seedCustomer returned no row');
  return row;
}

/** Creates its own customer unless `customerId` is given. */
export async function seedConversation(
  db: Database,
  merchantId: string,
  overrides: Partial<typeof schema.conversation.$inferInsert> = {},
) {
  const customerId = overrides.customerId ?? (await seedCustomer(db, merchantId)).id;
  const at = overrides.lastMessageAt ?? new Date();
  const [row] = await db
    .insert(schema.conversation)
    .values({
      merchantId,
      facebookPageId: 'seed-page',
      lastMessageAt: at,
      lastMessagePreview: 'Hi',
      lastMessageSender: 'customer',
      lastInboundAt: at,
      ...overrides,
      customerId,
    })
    .returning();
  if (!row) throw new Error('seedConversation returned no row');
  return row;
}

export async function seedMessage(
  db: Database,
  merchantId: string,
  conversationId: string,
  overrides: Partial<typeof schema.message.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.message)
    .values({
      merchantId,
      conversationId,
      sender: 'customer',
      text: 'Hi',
      status: 'sent',
      metaMessageId: `mid-${randomUUID()}`,
      sentAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seedMessage returned no row');
  return row;
}
