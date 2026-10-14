import { parseProductRef } from '@app/shared';

/**
 * Facebook's own hosts, the only ones whose links are read. Nothing else is
 * parsed, and only a short link on one of them is ever fetched (SSRF).
 */
const ROOT_HOSTS = ['facebook.com', 'fb.me', 'm.me'] as const;

/** How long the one redirect hop of a short link may take. */
export const SHORT_LINK_TIMEOUT_MS = 3_000;

const NUMERIC_ID = /^\d{1,30}$/;
const PFBID = /^pfbid[0-9A-Za-z]{10,100}$/;

/** What a link names: a post by its ids, a short link to follow once, or one of our product links. */
export type PostRef =
  | {
      kind: 'post';
      /** A number or a `pfbid…` id. */
      postId: string;
      /** The Page or profile the link names as the post's owner, when it is numeric. */
      ownerId: string | null;
    }
  | { kind: 'short'; url: URL }
  | { kind: 'product'; productId: string };

/**
 * The link as a URL when it is http(s) on one of Facebook's hosts, with no
 * credentials and no port; null for anything else, `javascript:` and IP
 * addresses included.
 */
export function allowedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const allowed = ROOT_HOSTS.some((root) => host === root || host.endsWith(`.${root}`));
  return allowed ? url : null;
}

const isFacebook = (host: string) => host === 'facebook.com' || host.endsWith('.facebook.com');
const isRoot = (host: string, root: string) => host === root || host === `www.${root}`;

const postIdOf = (value: string | null | undefined): string | null =>
  value && (NUMERIC_ID.test(value) || PFBID.test(value)) ? value : null;

const ownerIdOf = (value: string | null | undefined): string | null =>
  value && NUMERIC_ID.test(value) ? value : null;

function post(postId: string | null, ownerId: string | null = null): PostRef | null {
  return postId ? { kind: 'post', postId, ownerId: ownerIdOf(ownerId) } : null;
}

/**
 * What an allowed link names. Post, photo, video, reel and permalink links
 * give their ids; `/share/…` and fb.me links are short links whose target is
 * known only after a redirect; an `m.me` link carrying our `p_<id>` ref names
 * a product. Anything else is null.
 */
export function postRefOf(url: URL): PostRef | null {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const query = url.searchParams;

  if (isRoot(host, 'm.me')) {
    const productId = parseProductRef(query.get('ref') ?? '');
    return productId ? { kind: 'product', productId } : null;
  }
  if (isRoot(host, 'fb.me')) return parts.length > 0 ? { kind: 'short', url } : null;
  if (!isFacebook(host) || host === 'l.facebook.com' || host === 'lm.facebook.com') return null;

  const [first, second, third, fourth] = parts;
  if (first === 'share' && parts.length >= 2) return { kind: 'short', url };
  if (first === 'permalink.php' || first === 'story.php') {
    return post(postIdOf(query.get('story_fbid')), query.get('id'));
  }
  if (first === 'photo.php' || first === 'photo') return post(postIdOf(query.get('fbid')));
  if (first === 'watch') return post(postIdOf(query.get('v')));
  if (first === 'reel' || first === 'videos') return post(postIdOf(second));
  if (second === 'posts' || second === 'videos') return post(postIdOf(third), first);
  if (second === 'photos') return post(postIdOf(fourth ?? third), first);
  return null;
}

/** A post id from a webhook's `post` attachment: `<owner>_<post>`, or the post's number alone. */
export function postRefOfId(id: string | number | null | undefined): PostRef | null {
  if (id === null || id === undefined) return null;
  const value = String(id);
  const joined = /^(\d{1,30})_(\d{1,30})$/.exec(value);
  if (joined) return post(joined[2]!, joined[1]!);
  return post(postIdOf(value));
}

/**
 * Graph's id for a post, which `GET /{id}` reads: `<owner>_<number>` for a
 * numeric post id, and `<Page>_<pfbid…>` for a pfbid one, which Graph answers
 * with the post's numeric id. The bare pfbid id is refused (error 12).
 */
export function graphPostId(ref: Extract<PostRef, { kind: 'post' }>, pageId: string): string {
  return NUMERIC_ID.test(ref.postId)
    ? `${ref.ownerId ?? pageId}_${ref.postId}`
    : `${pageId}_${ref.postId}`;
}

/** Up to this many links are read from one message. */
export const MAX_LINKS = 5;

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+/giu;

/** Links on Facebook's hosts typed or pasted into a message, as written. */
export function linksInText(text: string): string[] {
  const found = text.match(URL_IN_TEXT) ?? [];
  return found
    .map((raw) => raw.replace(/[),.!?;:]+$/u, ''))
    .filter((raw) => allowedUrl(raw) !== null)
    .slice(0, MAX_LINKS);
}

type FetchFn = typeof fetch;

/**
 * Follows a short link one hop: one GET with redirects off and a timeout,
 * then the `Location` is parsed like any link, never fetched. A redirect to
 * Facebook's log-in page carries the target in `next`, which is read the same
 * way. Null on any failure, a second short link, or a host outside the list.
 */
export async function followShortLink(
  url: URL,
  fetchFn: FetchFn = fetch,
  timeoutMs = SHORT_LINK_TIMEOUT_MS,
): Promise<PostRef | null> {
  if (!allowedUrl(url.toString())) return null;
  const target = new URL(url.toString());
  target.protocol = 'https:';
  let location: string | null;
  try {
    const response = await fetchFn(target, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    location =
      response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    await response.body?.cancel().catch(() => undefined);
  } catch {
    return null;
  }
  if (!location) return null;
  let next: URL;
  try {
    next = new URL(location, target);
  } catch {
    return null;
  }
  const allowed = allowedUrl(next.toString());
  if (!allowed) return null;
  const loginNext = allowed.pathname.startsWith('/login') ? allowed.searchParams.get('next') : null;
  const resolved = loginNext ? allowedUrl(loginNext) : allowed;
  if (!resolved) return null;
  const ref = postRefOf(resolved);
  return ref?.kind === 'short' ? null : ref;
}

/** A post's two ids from Graph: its number from the Graph id, its `pfbid…` id from its link. */
export function idsOfGraphPost(post: { id: string; permalinkUrl: string | null }): {
  postId: string;
  aliasId: string | null;
} | null {
  const byId = postRefOfId(post.id);
  if (byId?.kind !== 'post') return null;
  const link = post.permalinkUrl ? allowedUrl(post.permalinkUrl) : null;
  const byLink = link ? postRefOf(link) : null;
  const aliasId = byLink?.kind === 'post' && byLink.postId !== byId.postId ? byLink.postId : null;
  return { postId: byId.postId, aliasId };
}
