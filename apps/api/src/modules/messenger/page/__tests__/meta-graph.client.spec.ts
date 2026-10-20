import {
  GraphError,
  MetaGraphClient,
  PAGE_CONNECT_SCOPES,
  appSecretProof,
} from '../meta-graph.client';
import { buildMessengerProfile, PROFILE_FIELDS } from '../../profile/messenger-profile';

interface Call {
  method: string;
  url: URL;
  authorization?: string;
  body?: unknown;
}

/** A fetch that records each call and answers from a queue. */
function fakeFetch(...answers: { status?: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fn = (async (input: URL | string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      method: init?.method ?? 'GET',
      url: new URL(input),
      authorization: headers.authorization,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error('unexpected fetch');
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const settings = { appId: 'app-1', appSecret: 'app-secret', version: 'v21.0' };

describe('MetaGraphClient', () => {
  it('builds the Login dialog URL for the Page permissions', () => {
    const client = new MetaGraphClient(settings, fakeFetch().fn);
    const url = new URL(client.authorizeUrl('st4te', 'https://shop.test/cb'));

    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'app-1',
      redirect_uri: 'https://shop.test/cb',
      state: 'st4te',
      response_type: 'code',
      scope: PAGE_CONNECT_SCOPES.join(','),
      auth_type: 'rerequest',
    });
  });

  it('trades the code for a long-lived user token', async () => {
    const { fn, calls } = fakeFetch(
      { body: { access_token: 'short' } },
      { body: { access_token: 'long' } },
    );
    const client = new MetaGraphClient(settings, fn);

    await expect(client.exchangeCode('the-code', 'https://shop.test/cb')).resolves.toBe('long');
    expect(calls[0]?.url.pathname).toBe('/v21.0/oauth/access_token');
    expect(calls[0]?.url.searchParams.get('code')).toBe('the-code');
    expect(calls[0]?.url.searchParams.get('redirect_uri')).toBe('https://shop.test/cb');
    expect(calls[1]?.url.searchParams.get('grant_type')).toBe('fb_exchange_token');
    expect(calls[1]?.url.searchParams.get('fb_exchange_token')).toBe('short');
  });

  it('sends tokens in the Authorization header with appsecret_proof, never in the query', async () => {
    const { fn, calls } = fakeFetch({
      body: {
        data: [{ id: '42', name: 'Rahim Kitchen', tasks: ['MESSAGING', 7] }, { name: 'no id' }],
      },
    });
    const client = new MetaGraphClient(settings, fn);

    await expect(client.listPages('user-token')).resolves.toEqual([
      { id: '42', name: 'Rahim Kitchen', tasks: ['MESSAGING'] },
    ]);
    expect(calls[0]?.authorization).toBe('Bearer user-token');
    expect(calls[0]?.url.searchParams.get('access_token')).toBeNull();
    expect(calls[0]?.url.searchParams.get('appsecret_proof')).toBe(
      appSecretProof('user-token', 'app-secret'),
    );
  });

  it('reads only granted permissions', async () => {
    const { fn } = fakeFetch({
      body: {
        data: [
          { permission: 'pages_show_list', status: 'granted' },
          { permission: 'pages_messaging', status: 'declined' },
        ],
      },
    });
    const granted = await new MetaGraphClient(settings, fn).grantedPermissions('t');
    expect([...granted]).toEqual(['pages_show_list']);
  });

  it('reads a Page with its token from the granted Pages, and null for any other', async () => {
    const accounts = {
      body: {
        data: [
          { id: '42', name: 'Rahim Kitchen', tasks: ['MESSAGING'], access_token: 'page-token' },
          { id: '43', name: 'Granted, no token', tasks: ['MESSAGING'] },
        ],
      },
    };
    const { fn, calls } = fakeFetch(accounts, accounts, accounts);
    const client = new MetaGraphClient(settings, fn);

    await expect(client.getPage('t', '42')).resolves.toEqual({
      id: '42',
      name: 'Rahim Kitchen',
      tasks: ['MESSAGING'],
      accessToken: 'page-token',
    });
    await expect(client.getPage('t', '999')).resolves.toBeNull();
    await expect(client.getPage('t', '43')).resolves.toBeNull();

    // `tasks` exists only on the /me/accounts edge; asking a Page node for it
    // is Graph error 100, so the Page must be read from the edge.
    expect(calls[0]?.url.pathname).toBe('/v21.0/me/accounts');
    expect(calls[0]?.url.searchParams.get('fields')).toBe('id,name,tasks,access_token');
  });

  it('subscribes the app to the Page webhooks with the Page token', async () => {
    const { fn, calls } = fakeFetch({ body: { success: true } });
    await new MetaGraphClient(settings, fn).subscribeApp('42', 'page-token');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/v21.0/42/subscribed_apps');
    expect(calls[0]?.url.searchParams.get('subscribed_fields')).toBe(
      'messages,messaging_postbacks,message_echoes,messaging_referrals,message_reactions,message_edits',
    );
    expect(calls[0]?.authorization).toBe('Bearer page-token');
  });

  it('sets the Messenger Profile with the Page token, as a JSON body', async () => {
    const { fn, calls } = fakeFetch({ body: { result: 'success' } });
    const body = buildMessengerProfile({ greeting: 'Hi', iceBreakers: [], language: 'en' });
    await new MetaGraphClient(settings, fn).setMessengerProfile('page-token', body);

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/v21.0/me/messenger_profile');
    expect(calls[0]?.authorization).toBe('Bearer page-token');
    expect(calls[0]?.body).toEqual(body);
  });

  it('clears every Messenger Profile field we own', async () => {
    const { fn, calls } = fakeFetch({ body: { result: 'success' } });
    await new MetaGraphClient(settings, fn).clearMessengerProfile('page-token');

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url.pathname).toBe('/v21.0/me/messenger_profile');
    expect(calls[0]?.authorization).toBe('Bearer page-token');
    expect(calls[0]?.body).toEqual({ fields: [...PROFILE_FIELDS] });
  });

  it('fails with a GraphError that names neither the token nor the URL', async () => {
    const { fn } = fakeFetch({ status: 401, body: { error: { code: 190, message: 'expired' } } });
    const error = await new MetaGraphClient(settings, fn)
      .listPages('secret-user-token')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({ status: 401, graphCode: 190 });
    expect((error as Error).message).not.toContain('secret-user-token');
    expect((error as Error).message).not.toContain('appsecret_proof');
  });

  it('reports a network failure as a 503 without the underlying error', async () => {
    const fn = (async () => {
      throw new TypeError('fetch failed for https://graph.facebook.com/?code=secret');
    }) as typeof fetch;
    const error = await new MetaGraphClient(settings, fn)
      .exchangeCode('secret', 'https://shop.test/cb')
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 503 });
    expect((error as Error).message).not.toContain('secret');
  });

  describe('Messenger calls with the Page token', () => {
    it("reads a customer's name and picture from their profile", async () => {
      const fetch = fakeFetch({
        body: {
          name: 'Nusrat Jahan',
          profile_pic: 'https://platform-lookaside.fbsbx.com/pic?psid=1',
          id: 'psid-1',
        },
      });
      const client = new MetaGraphClient(settings, fetch.fn);

      await expect(client.getUserProfile('page-token', 'psid-1')).resolves.toEqual({
        name: 'Nusrat Jahan',
        pictureUrl: 'https://platform-lookaside.fbsbx.com/pic?psid=1',
      });

      const [call] = fetch.calls;
      expect(call?.method).toBe('GET');
      expect(call?.url.pathname).toBe('/v21.0/psid-1');
      expect(call?.url.searchParams.get('fields')).toBe('name,profile_pic');
      expect(call?.url.searchParams.get('appsecret_proof')).toBe(
        appSecretProof('page-token', 'app-secret'),
      );
      expect(call?.authorization).toBe('Bearer page-token');
    });

    it('answers nulls when Facebook shares no name or picture', async () => {
      const client = new MetaGraphClient(settings, fakeFetch({ body: { id: 'psid-1' } }).fn);
      await expect(client.getUserProfile('page-token', 'psid-1')).resolves.toEqual({
        name: null,
        pictureUrl: null,
      });
    });

    it('drops a picture link that is not https', async () => {
      const client = new MetaGraphClient(
        settings,
        fakeFetch({ body: { name: 'Nusrat', profile_pic: 'javascript:alert(1)' } }).fn,
      );
      await expect(client.getUserProfile('page-token', 'psid-1')).resolves.toEqual({
        name: 'Nusrat',
        pictureUrl: null,
      });
    });

    it('sends a text reply as a RESPONSE and returns its message id', async () => {
      const fetch = fakeFetch({ body: { recipient_id: 'psid-1', message_id: 'm_abc' } });
      const client = new MetaGraphClient(settings, fetch.fn);

      await expect(
        client.sendText('page-token', 'psid-1', 'Your parcel ships today'),
      ).resolves.toEqual({ messageId: 'm_abc' });

      const [call] = fetch.calls;
      expect(call?.method).toBe('POST');
      expect(call?.url.pathname).toBe('/v21.0/me/messages');
      expect(call?.authorization).toBe('Bearer page-token');
      expect(call?.body).toEqual({
        recipient: { id: 'psid-1' },
        messaging_type: 'RESPONSE',
        message: { text: 'Your parcel ships today' },
      });
    });

    it('sends quick replies with titles cut to 20 characters without splitting a letter, at most 13', async () => {
      const fetch = fakeFetch({ body: { message_id: 'm_q' } });
      const client = new MetaGraphClient(settings, fetch.fn);
      const options = Array.from({ length: 14 }, (_, i) => ({
        title: i === 0 ? 'লাল জামদানি শাড়ি (বড় সাইজ)' : `Option ${i}`,
        payload: `pick:product:${i}`,
      }));

      await expect(
        client.sendQuickReplies('page-token', 'psid-1', 'Which one?', options),
      ).resolves.toEqual({ messageId: 'm_q' });

      const body = fetch.calls[0]?.body as {
        messaging_type: string;
        message: {
          text: string;
          quick_replies: { content_type: string; title: string; payload: string }[];
        };
      };
      expect(body.messaging_type).toBe('RESPONSE');
      expect(body.message.text).toBe('Which one?');
      expect(body.message.quick_replies).toHaveLength(13);
      expect(body.message.quick_replies[1]).toEqual({
        content_type: 'text',
        title: 'Option 1',
        payload: 'pick:product:1',
      });
      expect(body.message.quick_replies[0]!.title).toBe('লাল জামদানি শাড়ি (…');
    });

    it('sends a button template with postback buttons', async () => {
      const fetch = fakeFetch({ body: { message_id: 'm_b' } });
      const client = new MetaGraphClient(settings, fetch.fn);

      await client.sendButtonTemplate('page-token', 'psid-1', 'Total: ৳3,260.00', [
        { title: 'Confirm', payload: 'confirm:c:2' },
        { title: 'Change something', payload: 'change:c:2' },
      ]);

      expect(fetch.calls[0]?.body).toEqual({
        recipient: { id: 'psid-1' },
        messaging_type: 'RESPONSE',
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: 'Total: ৳3,260.00',
              buttons: [
                { type: 'postback', title: 'Confirm', payload: 'confirm:c:2' },
                { type: 'postback', title: 'Change something', payload: 'change:c:2' },
              ],
            },
          },
        },
      });
    });

    it('sends a carousel as a generic template with one postback button per card', async () => {
      const fetch = fakeFetch({ body: { message_id: 'm_g' } });
      const client = new MetaGraphClient(settings, fetch.fn);

      await client.sendGenericTemplate('page-token', 'psid-1', [
        {
          title: 'Jamdani saree',
          subtitle: 'From ৳4,500',
          imageUrl: 'https://img.test/1.jpg',
          button: { title: 'Choose', payload: 'choose:product:x' },
        },
        {
          title: 'Kurti',
          subtitle: 'From ৳1,600',
          imageUrl: null,
          button: { title: 'Choose', payload: 'choose:product:y' },
        },
      ]);

      expect(fetch.calls[0]?.body).toEqual({
        recipient: { id: 'psid-1' },
        messaging_type: 'RESPONSE',
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [
                {
                  title: 'Jamdani saree',
                  subtitle: 'From ৳4,500',
                  image_url: 'https://img.test/1.jpg',
                  buttons: [{ type: 'postback', title: 'Choose', payload: 'choose:product:x' }],
                },
                {
                  title: 'Kurti',
                  subtitle: 'From ৳1,600',
                  buttons: [{ type: 'postback', title: 'Choose', payload: 'choose:product:y' }],
                },
              ],
            },
          },
        },
      });
    });

    it('sends at most ten cards', async () => {
      const fetch = fakeFetch({ body: { message_id: 'm_g' } });
      const client = new MetaGraphClient(settings, fetch.fn);
      const card = {
        title: 'T',
        subtitle: 'S',
        imageUrl: null,
        button: { title: 'Choose', payload: 'choose:product:x' },
      };

      await client.sendGenericTemplate('page-token', 'psid-1', Array(12).fill(card));

      const elements = (
        fetch.calls[0]?.body as { message: { attachment: { payload: { elements: unknown[] } } } }
      ).message.attachment.payload.elements;
      expect(elements).toHaveLength(10);
    });

    it('sends an image by its URL', async () => {
      const fetch = fakeFetch({ body: { message_id: 'm_i' } });
      const client = new MetaGraphClient(settings, fetch.fn);

      await client.sendImage('page-token', 'psid-1', 'https://cdn.test/saree.jpg');

      expect(fetch.calls[0]?.body).toEqual({
        recipient: { id: 'psid-1' },
        messaging_type: 'RESPONSE',
        message: {
          attachment: {
            type: 'image',
            payload: { url: 'https://cdn.test/saree.jpg', is_reusable: true },
          },
        },
      });
    });

    it('fails a send Facebook refused, without the token in the error', async () => {
      const client = new MetaGraphClient(
        settings,
        fakeFetch({ status: 400, body: { error: { code: 10, message: 'outside window' } } }).fn,
      );

      const error = await client.sendText('page-token', 'psid-1', 'hi').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GraphError);
      expect((error as GraphError).graphCode).toBe(10);
      expect((error as GraphError).message).not.toContain('page-token');
    });

    it("names Facebook's subcode and reason, with token-shaped text masked", async () => {
      const leaked = 'EAAG'.padEnd(60, 'x');
      const client = new MetaGraphClient(
        settings,
        fakeFetch({
          status: 400,
          body: {
            error: {
              code: 2022,
              error_subcode: 2018108,
              message: `This person isn't available right now (${leaked})`,
            },
          },
        }).fn,
      );

      const error = await client.sendText('page-token', 'psid-1', 'hi').catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 400, graphCode: 2022, graphSubcode: 2018108 });
      expect((error as GraphError).message).toBe(
        "Graph POST /me/messages failed with 400 (code 2022, subcode 2018108): This person isn't available right now ([redacted])",
      );
    });

    it('fails a send answered without a message id', async () => {
      const client = new MetaGraphClient(
        settings,
        fakeFetch({ body: { recipient_id: 'psid-1' } }).fn,
      );
      await expect(client.sendText('page-token', 'psid-1', 'hi')).rejects.toBeInstanceOf(
        GraphError,
      );
    });
  });

  describe('listPublishedPosts', () => {
    const range = {
      since: new Date('2026-07-01T00:00:00Z'),
      until: new Date('2026-10-01T00:00:00Z'),
    };

    it("reads every photo of an album, leaves videos out, and returns the next page's cursor", async () => {
      const { fn, calls } = fakeFetch({
        body: {
          data: [
            {
              id: '1_10',
              message: 'New arrivals',
              created_time: '2026-08-01T10:00:00+0000',
              permalink_url: 'https://www.facebook.com/1/posts/10',
              attachments: {
                data: [
                  {
                    media_type: 'album',
                    subattachments: {
                      data: [
                        {
                          media_type: 'photo',
                          media: { image: { src: 'https://cdn.test/a.jpg' } },
                        },
                        {
                          media_type: 'video',
                          media: { image: { src: 'https://cdn.test/v.jpg' } },
                        },
                        { media_type: 'photo', media: { image: { src: 'http://cdn.test/b.jpg' } } },
                        {
                          media_type: 'photo',
                          media: { image: { src: 'https://cdn.test/c.jpg' } },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            { id: '1_11', attachments: { data: [{ media_type: 'video', media: {} }] } },
            { message: 'no id' },
          ],
          paging: { cursors: { after: 'AFTER' }, next: 'https://graph.facebook.com/next' },
        },
      });
      const client = new MetaGraphClient(settings, fn);

      const page = await client.listPublishedPosts('page-token', '1', {
        ...range,
        after: 'BEFORE',
      });

      expect(page).toEqual({
        posts: [
          {
            id: '1_10',
            message: 'New arrivals',
            permalinkUrl: 'https://www.facebook.com/1/posts/10',
            createdTime: '2026-08-01T10:00:00+0000',
            photoUrls: ['https://cdn.test/a.jpg', 'https://cdn.test/c.jpg'],
          },
          { id: '1_11', message: null, permalinkUrl: null, createdTime: null, photoUrls: [] },
        ],
        after: 'AFTER',
      });
      const query = Object.fromEntries(calls[0]!.url.searchParams);
      expect(calls[0]!.url.pathname).toBe('/v21.0/1/published_posts');
      expect(query).toMatchObject({
        since: String(range.since.getTime() / 1000),
        until: String(range.until.getTime() / 1000),
        limit: '25',
        after: 'BEFORE',
      });
      expect(query.fields).toContain('subattachments.limit(20)');
      expect(calls[0]!.authorization).toBe('Bearer page-token');
    });

    it('returns no cursor on the last page, even when Graph sends one', async () => {
      const { fn } = fakeFetch({ body: { data: [], paging: { cursors: { after: 'END' } } } });
      const client = new MetaGraphClient(settings, fn);

      await expect(client.listPublishedPosts('page-token', '1', range)).resolves.toEqual({
        posts: [],
        after: null,
      });
    });
  });
});
