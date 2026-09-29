import {
  MESSAGE_TEXT_MAX_LENGTH,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  updateConversationSchema,
} from '@app/shared';

describe('conversation request schemas', () => {
  it('reads list query strings the way a browser sends them', () => {
    expect(listConversationsQuerySchema.parse({})).toEqual({ filter: 'all', limit: 25 });
    expect(
      listConversationsQuerySchema.parse({ filter: 'needs_you', q: '  kurti ', limit: '10' }),
    ).toEqual({ filter: 'needs_you', q: 'kurti', limit: 10 });
  });

  it('treats an empty or blank search as no search', () => {
    expect(listConversationsQuerySchema.parse({ q: '' }).q).toBeUndefined();
    expect(listConversationsQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('refuses unknown filters and out-of-range limits', () => {
    expect(listConversationsQuerySchema.safeParse({ filter: 'spam' }).success).toBe(false);
    expect(listConversationsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listConversationsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(listMessagesQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(listMessagesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it("trims replies and holds them to Messenger's length limit", () => {
    expect(sendMessageSchema.parse({ text: '  hello ' })).toEqual({ text: 'hello' });
    expect(sendMessageSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ text: 'x'.repeat(MESSAGE_TEXT_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('lets a seller pause the assistant but never set the state directly', () => {
    expect(updateConversationSchema.parse({ botPaused: true })).toEqual({ botPaused: true });
    expect(
      updateConversationSchema.safeParse({ botPaused: false, state: 'confirmed' }).success,
    ).toBe(false);
  });
});
