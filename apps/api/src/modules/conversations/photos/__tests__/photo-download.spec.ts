import { downloadPhoto, photoUrl } from '../photo-download';

const LIMITS = { timeoutMs: 200, maxBytes: 16 };
const CDN = 'https://scontent.xx.fbcdn.net/v/t1/photo.jpg';

/** A fetch that answers each url from the table, recording what was asked for. */
function fetcher(answers: Record<string, () => Response | Promise<Response>>) {
  const asked: string[] = [];
  const fake = (async (input: URL | string) => {
    const url = String(input);
    asked.push(url);
    const answer = answers[url];
    if (!answer) throw new Error(`unexpected fetch of ${url}`);
    return answer();
  }) as typeof fetch;
  return { fake, asked };
}

describe('photoUrl', () => {
  it.each([CDN, 'https://cdn.fbsbx.com/v/a.jpg', 'https://lookaside.fbsbx.com/x'])(
    'accepts %s',
    (url) => {
      expect(photoUrl(url)?.href).toBe(url);
    },
  );
  it.each([
    null,
    'http://scontent.xx.fbcdn.net/a.jpg',
    'https://evil.example/fbcdn.net/a.jpg',
    'https://fbcdn.net.evil.example/a.jpg',
    'https://user:pw@scontent.xx.fbcdn.net/a.jpg',
    'https://scontent.xx.fbcdn.net:8443/a.jpg',
    'https://169.254.169.254/latest/meta-data',
    'not a url',
  ])('refuses %p', (url) => {
    expect(photoUrl(url)).toBeNull();
  });
});

describe('downloadPhoto', () => {
  it('returns the body of a photo within the limits', async () => {
    const { fake } = fetcher({ [CDN]: () => new Response(Buffer.from('jpeg-bytes')) });
    await expect(downloadPhoto(CDN, LIMITS, fake)).resolves.toEqual({
      ok: true,
      body: Buffer.from('jpeg-bytes'),
    });
  });

  it('refuses a host that is not Meta’s without fetching it', async () => {
    const { fake, asked } = fetcher({});
    await expect(downloadPhoto('https://evil.example/a.jpg', LIMITS, fake)).resolves.toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(asked).toEqual([]);
  });

  it('follows a redirect on Meta’s hosts, and refuses one that leaves them', async () => {
    const next = 'https://cdn.fbsbx.com/real.jpg';
    const ok = fetcher({
      [CDN]: () => new Response(null, { status: 302, headers: { location: next } }),
      [next]: () => new Response(Buffer.from('ok')),
    });
    await expect(downloadPhoto(CDN, LIMITS, ok.fake)).resolves.toMatchObject({ ok: true });
    expect(ok.asked).toEqual([CDN, next]);

    const away = fetcher({
      [CDN]: () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/x' } }),
    });
    await expect(downloadPhoto(CDN, LIMITS, away.fake)).resolves.toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });

  it('refuses an oversize photo by its declared length', async () => {
    const { fake } = fetcher({
      [CDN]: () => new Response(Buffer.alloc(4), { headers: { 'content-length': '999' } }),
    });
    await expect(downloadPhoto(CDN, LIMITS, fake)).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('refuses an oversize photo that declares no length, while it streams', async () => {
    const { fake } = fetcher({
      [CDN]: () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(10));
            },
          }),
        ),
    });
    await expect(downloadPhoto(CDN, LIMITS, fake)).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('times out a download that never finishes', async () => {
    const fake = ((_url: URL, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    await expect(downloadPhoto(CDN, LIMITS, fake)).resolves.toEqual({
      ok: false,
      reason: 'timeout',
    });
  });

  it('reports an error status or a network failure as failed', async () => {
    const notFound = fetcher({ [CDN]: () => new Response('gone', { status: 404 }) });
    await expect(downloadPhoto(CDN, LIMITS, notFound.fake)).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
    const down = fetcher({ [CDN]: () => Promise.reject(new TypeError('fetch failed')) });
    await expect(downloadPhoto(CDN, LIMITS, down.fake)).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });
});
