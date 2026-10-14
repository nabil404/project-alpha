import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import type { PagePost, Product, ProductPost } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useErrorMessages } from '@/i18n/error-keys';
// The queries file, not the messenger barrel, which reaches back into the catalog.
import { useFacebookPage } from '@/features/messenger/queries';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';

import {
  useAcceptProductPost,
  useLinkProductPost,
  usePagePosts,
  useProductPosts,
  useRemoveProductPost,
} from '../post-queries';

/**
 * Facebook posts that sell this product. A customer who shares a linked post
 * into Messenger is asked straight away which option they want; the
 * assistant's suggestions, from posts whose caption named the product, wait
 * here for the seller to accept.
 */
export function ProductPostsCard({ product }: { product: Product }) {
  const { t } = useTranslation('catalog');
  const { forError } = useErrorMessages();
  const toast = useToast();
  const page = useFacebookPage();
  const posts = useProductPosts(product.id);
  const link = useLinkProductPost(product.id);
  const [url, setUrl] = useState('');
  const connected = Boolean(page.data?.page);

  const rows = posts.data?.data ?? [];
  const suggested = rows.filter((post) => post.status === 'suggested');
  const linked = rows.filter((post) => post.status === 'linked');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    link.mutate(
      { url: url.trim() },
      {
        onSuccess: () => {
          setUrl('');
          toast.success(t('posts.linked'));
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('posts.title')}</h2>
        <p className="text-small text-ink-muted">{t('posts.description')}</p>
      </div>

      {suggested.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-label">{t('posts.suggestedTitle')}</h3>
          <p className="text-small text-ink-muted">{t('posts.suggestedHint')}</p>
          <ul className="flex flex-col gap-2">
            {suggested.map((post) => (
              <PostRow key={post.id} productId={product.id} post={post} />
            ))}
          </ul>
        </div>
      )}

      {posts.isError && <ErrorBanner>{forError(posts.error)}</ErrorBanner>}
      {linked.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {linked.map((post) => (
            <PostRow key={post.id} productId={product.id} post={post} />
          ))}
        </ul>
      ) : (
        posts.isSuccess && <p className="text-small text-ink-muted">{t('posts.empty')}</p>
      )}

      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        {link.isError && <ErrorBanner>{forError(link.error)}</ErrorBanner>}
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (link.isError) link.reset();
            }}
            inputMode="url"
            placeholder={t('posts.urlPlaceholder')}
            aria-label={t('posts.urlLabel')}
            className="min-w-0"
          />
          <Button type="submit" variant="secondary" disabled={link.isPending || !url.trim()}>
            {t('posts.link')}
          </Button>
        </div>
      </form>

      {connected ? (
        <PagePostPicker product={product} />
      ) : (
        <p className="text-small text-ink-muted">{t('posts.notConnected')}</p>
      )}
      {product.status !== 'active' && (
        <p className="rounded-md bg-surface-sunken p-3 text-small text-ink-muted">
          {t('posts.notPublished')}
        </p>
      )}
    </section>
  );
}

/** One post: its caption or link, with Unlink, or Accept and Dismiss for a suggestion. */
function PostRow({ productId, post }: { productId: string; post: ProductPost }) {
  const { t } = useTranslation('catalog');
  const toast = useToast();
  const accept = useAcceptProductPost(productId);
  const remove = useRemoveProductPost(productId);
  const busy = accept.isPending || remove.isPending;
  const name = post.caption ?? post.url ?? t('posts.untitled', { id: post.postId });

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-2 text-body break-words">{name}</p>
        {post.url && (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-small text-accent underline"
          >
            {t('posts.open')}
            <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.5} />
          </a>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {post.status === 'suggested' && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              accept.mutate(post.id, {
                onSuccess: () => toast.success(t('posts.accepted')),
                onError: toast.error,
              })
            }
          >
            {t('posts.accept')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            remove.mutate(post.id, {
              onSuccess: () => toast.success(t('posts.removed')),
              onError: toast.error,
            })
          }
        >
          {post.status === 'suggested' ? t('posts.dismiss') : t('posts.unlink')}
        </Button>
      </div>
    </li>
  );
}

/** The Page's newest posts, each linkable here unless another product holds it. */
function PagePostPicker({ product }: { product: Product }) {
  const { t } = useTranslation('catalog');
  const { forError } = useErrorMessages();
  const [open, setOpen] = useState(false);
  const recent = usePagePosts(open);
  const link = useLinkProductPost(product.id);
  const toast = useToast();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) link.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="self-start">
          {t('posts.pick')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('posts.pickTitle')}</DialogTitle>
          <DialogDescription>
            {t('posts.pickDescription', { name: product.name })}
          </DialogDescription>
        </DialogHeader>
        {recent.isError && <ErrorBanner>{forError(recent.error)}</ErrorBanner>}
        {link.isError && <ErrorBanner>{forError(link.error)}</ErrorBanner>}
        {recent.isPending && <p className="text-small text-ink-muted">{t('posts.loading')}</p>}
        {recent.isSuccess && recent.data.data.length === 0 && (
          <p className="text-small text-ink-muted">{t('posts.noRecent')}</p>
        )}
        {recent.isSuccess && recent.data.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {recent.data.data.map((post) => (
              <PagePostRow
                key={post.id}
                post={post}
                productId={product.id}
                busy={link.isPending}
                onLink={() =>
                  link.mutate(
                    { pagePostId: post.id },
                    { onSuccess: () => toast.success(t('posts.linked')) },
                  )
                }
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PagePostRow({
  post,
  productId,
  busy,
  onLink,
}: {
  post: PagePost;
  productId: string;
  busy: boolean;
  onLink: () => void;
}) {
  const { t } = useTranslation('catalog');
  const { formatDate } = useFormatters();
  const here = post.linkedProduct?.id === productId;
  const elsewhere = post.linkedProduct !== null && !here;

  return (
    <li className="flex gap-3 rounded-md border border-border p-3">
      {post.pictureUrl ? (
        <img
          src={post.pictureUrl}
          alt=""
          className="size-14 shrink-0 rounded-md border border-border object-cover"
        />
      ) : (
        <div aria-hidden className="size-14 shrink-0 rounded-md bg-surface-sunken" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="line-clamp-2 text-body break-words">{post.message ?? t('posts.noCaption')}</p>
        <p className="text-small text-ink-muted">
          {post.createdAt && formatDate(post.createdAt, 'date')}
          {elsewhere && post.linkedProduct && (
            <> · {t('posts.linkedTo', { name: post.linkedProduct.name })}</>
          )}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={here ? 'ghost' : 'secondary'}
        className="shrink-0 self-center"
        disabled={busy || here || elsewhere}
        onClick={onLink}
      >
        {here ? t('posts.isLinked') : t('posts.link')}
      </Button>
    </li>
  );
}
