import {
  allowedUrl,
  followShortLink,
  graphPostId,
  idsOfGraphPost,
  linksInText,
  postRefOf,
  postRefOfId,
} from '../post-links';

const PRODUCT_ID = '3f2c1b7e-8a9d-4c5e-9f10-112233445566';
const PFBID = 'pfbid02aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890';

const refOf = (raw: string) => {
  const url = allowedUrl(raw);
  return url ? postRefOf(url) : 'refused';
};

describe('allowedUrl', () => {
  it.each([
    'https://www.facebook.com/shop/posts/123',
    'https://facebook.com/shop/posts/123',
    'http://m.facebook.com/story.php?story_fbid=1&id=2',
    'https://web.facebook.com/shop/posts/123',
    'https://fb.me/abc',
    'https://m.me/12345?ref=p_x',
  ])('accepts %s', (raw) => {
    expect(allowedUrl(raw)).not.toBeNull();
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,hi'],
    ['an IPv4 address', 'http://127.0.0.1/shop/posts/1'],
    ['an IPv6 address', 'http://[::1]/shop/posts/1'],
    ['the metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['another host', 'https://example.com/shop/posts/1'],
    ['a lookalike suffix', 'https://facebook.com.evil.test/shop/posts/1'],
    ['a lookalike prefix', 'https://evilfacebook.com/shop/posts/1'],
    ['credentials', 'https://user:pass@facebook.com/shop/posts/1'],
    ['a port', 'https://facebook.com:8443/shop/posts/1'],
    ['ftp', 'ftp://facebook.com/shop/posts/1'],
    ['not a URL', 'facebook dot com'],
  ])('refuses %s', (_name, raw) => {
    expect(allowedUrl(raw)).toBeNull();
  });
});

describe('postRefOf', () => {
  it('reads a post link with its owner', () => {
    expect(refOf('https://www.facebook.com/100200/posts/987654321')).toEqual({
      kind: 'post',
      postId: '987654321',
      ownerId: '100200',
    });
  });

  it('reads a pfbid post link under a Page name, with no numeric owner', () => {
    expect(refOf(`https://www.facebook.com/myshop/posts/${PFBID}`)).toEqual({
      kind: 'post',
      postId: PFBID,
      ownerId: null,
    });
  });

  it.each([
    [
      'permalink.php',
      'https://www.facebook.com/permalink.php?story_fbid=555&id=100200',
      '555',
      '100200',
    ],
    ['story.php', 'https://m.facebook.com/story.php?story_fbid=555&id=100200', '555', '100200'],
    ['photo', 'https://www.facebook.com/photo/?fbid=777', '777', null],
    ['photo.php', 'https://www.facebook.com/photo.php?fbid=777', '777', null],
    ['an album photo', 'https://www.facebook.com/myshop/photos/a.111/777/', '777', null],
    ['a video', 'https://www.facebook.com/myshop/videos/888', '888', null],
    ['watch', 'https://www.facebook.com/watch/?v=888', '888', null],
    ['a reel', 'https://www.facebook.com/reel/999', '999', null],
  ])('reads %s', (_name, raw, postId, ownerId) => {
    expect(refOf(raw)).toEqual({ kind: 'post', postId, ownerId });
  });

  it('treats share and fb.me links as short links to follow', () => {
    expect(refOf('https://www.facebook.com/share/p/1AbCdEf/')).toMatchObject({ kind: 'short' });
    expect(refOf('https://fb.me/1AbCdEf')).toMatchObject({ kind: 'short' });
  });

  it('reads our own m.me product link', () => {
    expect(refOf(`https://m.me/100200?ref=p_${PRODUCT_ID}`)).toEqual({
      kind: 'product',
      productId: PRODUCT_ID,
    });
    expect(refOf('https://m.me/100200?ref=summer')).toBeNull();
  });

  it.each([
    ['a profile', 'https://www.facebook.com/someone'],
    ['a group post', 'https://www.facebook.com/groups/1/posts/2'],
    ['the outbound link wrapper', 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com'],
    ['a post id that is not an id', 'https://www.facebook.com/shop/posts/hello'],
  ])('ignores %s', (_name, raw) => {
    expect(refOf(raw)).toBeNull();
  });
});

describe('postRefOfId and graphPostId', () => {
  it('splits a Graph id into owner and post', () => {
    const ref = postRefOfId('100200_987');
    expect(ref).toEqual({ kind: 'post', postId: '987', ownerId: '100200' });
    expect(graphPostId(ref as never, 'page')).toBe('100200_987');
  });

  it('puts the Page in front of a bare number', () => {
    const ref = postRefOfId(987);
    expect(graphPostId(ref as never, '100200')).toBe('100200_987');
  });

  it('reads a pfbid under the Page, whatever owner its link names', () => {
    // Graph refuses the bare pfbid (error 12) and answers <Page>_<pfbid> with the numeric id.
    expect(graphPostId({ kind: 'post', postId: PFBID, ownerId: '61595013491325' }, '100200')).toBe(
      `100200_${PFBID}`,
    );
  });

  it('reads both ids from a Graph post', () => {
    expect(
      idsOfGraphPost({
        id: '100200_987',
        permalinkUrl: `https://www.facebook.com/myshop/posts/${PFBID}`,
      }),
    ).toEqual({ postId: '987', aliasId: PFBID });
  });
});

describe('linksInText', () => {
  it('keeps Facebook links and drops the rest', () => {
    expect(
      linksInText(
        'how much is this? https://www.facebook.com/shop/posts/1, also https://example.com/x',
      ),
    ).toEqual(['https://www.facebook.com/shop/posts/1']);
  });
});

describe('followShortLink', () => {
  const short = new URL('https://www.facebook.com/share/p/1AbCdEf/');
  const redirectTo = (location: string, status = 302) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchFn = ((url: URL, init?: RequestInit) => {
      calls.push({ url: url.toString(), init });
      return Promise.resolve(new Response(null, { status, headers: { location } }));
    }) as unknown as typeof fetch;
    return { fetchFn, calls };
  };

  it('follows one redirect, without following it further', async () => {
    const { fetchFn, calls } = redirectTo('https://www.facebook.com/100200/posts/987');
    await expect(followShortLink(short, fetchFn)).resolves.toEqual({
      kind: 'post',
      postId: '987',
      ownerId: '100200',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows at most one redirect: a second short link is not fetched', async () => {
    const { fetchFn, calls } = redirectTo('https://www.facebook.com/share/p/2Other/');
    await expect(followShortLink(short, fetchFn)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('reads the target from a log-in redirect', async () => {
    const next = encodeURIComponent('https://www.facebook.com/100200/posts/987');
    const { fetchFn } = redirectTo(`https://www.facebook.com/login/?next=${next}`);
    await expect(followShortLink(short, fetchFn)).resolves.toMatchObject({ postId: '987' });
  });

  it.each([
    ['another host', 'https://evil.test/100200/posts/987'],
    ['an IP address', 'http://169.254.169.254/latest/meta-data'],
    ['a relative path that leaves nothing to read', '/'],
  ])('refuses a redirect to %s', async (_name, location) => {
    const { fetchFn } = redirectTo(location);
    await expect(followShortLink(short, fetchFn)).resolves.toBeNull();
  });

  it('returns null without a redirect', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response('ok', { status: 200 }))) as unknown as typeof fetch;
    await expect(followShortLink(short, fetchFn)).resolves.toBeNull();
  });

  it('returns null when the hop times out', async () => {
    const fetchFn = ((_url: URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    await expect(followShortLink(short, fetchFn, 20)).resolves.toBeNull();
  });

  it('never fetches a link off the allowed hosts', async () => {
    const { fetchFn, calls } = redirectTo('https://www.facebook.com/100200/posts/987');
    await expect(
      followShortLink(new URL('https://evil.test/share/p/1'), fetchFn),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
