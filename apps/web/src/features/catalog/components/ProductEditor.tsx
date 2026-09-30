import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useForm, useWatch, type Path, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  createProductSchema,
  productStatusSchema,
  type CreateProduct,
  type Product,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessages } from '@/i18n/error-keys';
import { useStatusLabels } from '@/i18n/status-keys';
import { ApiError } from '@/lib/api-error';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';
import { cn } from '@/lib/utils';

import { emptyProduct, toDocument, toFormValues, type ProductFormValues } from '../product-form';
import { catalogKeys, productQueryOptions, useCreateProduct, useSaveProduct } from '../queries';
import { CategoryPicker } from './CategoryPicker';
import { CommaListInput } from './CommaListInput';
import { DeleteProductButton } from './DeleteProductButton';
import { PhotosCard } from './PhotosCard';
import { ProductStatusBadge } from './ProductStatusBadge';
import { VariantsCard } from './VariantsCard';

const card = 'flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card';
/** Main column and side column; 22rem is just wide enough for Delete, Discard and Save in one row. */
const columns = 'lg:grid-cols-[minmax(0,1fr)_22rem]';
const topLevelFields = [
  'name',
  'description',
  'status',
  'aliases',
  'categoryIds',
  'options',
  'variants',
];

/**
 * The product add/edit page. The whole page is one document: nothing but
 * photos is written until Save, and Discard puts it back as it was read.
 * Without `product`, it creates one and then moves to that product's page.
 */
export function ProductEditor({ product }: { product?: Product }) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError, forField } = useErrorMessages();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useCreateProduct();
  const save = useSaveProduct();
  const [baseVersion, setBaseVersion] = useState(product?.version);
  const leaving = useRef(false);

  const form = useForm<ProductFormValues, unknown, CreateProduct>({
    // The form holds the schema's input with every default filled in, plus
    // coverImageId, which the schema strips and Save reads from the form.
    // Resolver types are invariant in their input, hence the cast.
    resolver: useZodResolver(createProductSchema) as unknown as Resolver<
      ProductFormValues,
      unknown,
      CreateProduct
    >,
    defaultValues: product ? toFormValues(product) : emptyProduct,
  });
  const { isDirty } = form.formState;

  // Uploading the first photo or deleting the default moves the default on the
  // server without changing the version. Follow it, unless the seller picked
  // one that still exists.
  const serverCover = product?.coverImageId ?? null;
  const imageIds = product?.images.map((image) => image.id).join() ?? '';
  useEffect(() => {
    const picked = form.getValues('coverImageId');
    const stillThere = picked !== null && imageIds.split(',').includes(picked);
    if (!form.getFieldState('coverImageId').isDirty || !stillThere) {
      form.resetField('coverImageId', { defaultValue: serverCover });
    }
  }, [form, serverCover, imageIds]);
  const mutation = product ? save : create;
  const busy = mutation.isPending;

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty && !leaving.current,
    enableBeforeUnload: () => isDirty && !leaving.current,
    withResolver: true,
  });

  const leave = (to: () => Promise<void>) => {
    leaving.current = true;
    return to().finally(() => {
      leaving.current = false;
    });
  };

  const onError = (error: unknown) => {
    const fields =
      error instanceof ApiError
        ? Object.keys(error.fields).filter((name) => topLevelFields.includes(name.split('.')[0]!))
        : [];
    applyServerFieldErrors(error, form.setError, fields as Path<ProductFormValues>[], forField);
  };

  const onSubmit = (values: CreateProduct) => {
    const document = toDocument(values);

    if (!product) {
      create.mutate(document, {
        onSuccess: (created) => {
          form.reset(toFormValues(created));
          void leave(() =>
            navigate({
              to: '/catalog/products/$productId',
              params: { productId: created.id },
              replace: true,
            }),
          );
        },
        onError,
      });
      return;
    }

    save.mutate(
      {
        id: product.id,
        input: {
          ...document,
          version: baseVersion!,
          coverImageId: form.getValues('coverImageId'),
        },
      },
      {
        onSuccess: (saved) => {
          setBaseVersion(saved.version);
          form.reset(toFormValues(saved));
        },
        onError,
      },
    );
  };

  const reloadLatest = async () => {
    if (!product) return;
    const latest = await queryClient.fetchQuery({
      ...productQueryOptions(product.id),
      staleTime: 0,
    });
    setBaseVersion(latest.version);
    form.reset(toFormValues(latest));
    save.reset();
  };

  const discard = () => {
    if (!product) {
      void leave(() => navigate({ to: '/catalog' }));
      return;
    }
    form.reset();
    mutation.reset();
  };

  const name = useWatch({ control: form.control, name: 'name' });
  const title = product ? name.trim() || product.name : t('editor.newTitle');
  const stale = mutation.error instanceof ApiError && mutation.error.code === 'PRODUCT_STALE';

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <nav aria-label={t('editor.breadcrumb')}>
              <ol className="flex min-w-0 items-center gap-1 text-small text-ink-muted">
                <li className="shrink-0">
                  <Link to="/catalog" className="hover:text-ink">
                    {t('list.title')}
                  </Link>
                </li>
                <li aria-hidden className="flex text-border-strong">
                  <ChevronRight className="size-3.5" strokeWidth={1.5} />
                </li>
                <li aria-current="page" className="truncate font-medium text-ink">
                  {title}
                </li>
              </ol>
            </nav>
            {/* The columns below, so the actions start where the side column does. */}
            <div className={cn('mt-1 flex flex-wrap items-center gap-4 lg:grid lg:gap-6', columns)}>
              <div className="flex min-w-0 grow items-center gap-3">
                <h1 className="truncate text-display">{title}</h1>
                {product && <ProductStatusBadge status={product.status} />}
              </div>
              <div className="flex flex-wrap gap-3">
                {product && (
                  <DeleteProductButton
                    productId={product.id}
                    name={product.name}
                    onDeleted={() =>
                      void leave(() => navigate({ to: '/catalog' })).then(() =>
                        queryClient.removeQueries({ queryKey: catalogKeys.product(product.id) }),
                      )
                    }
                  />
                )}
                <Button type="button" disabled={busy || (!!product && !isDirty)} onClick={discard}>
                  {t('editor.actions.discard')}
                </Button>
                <Button type="submit" variant="primary" disabled={busy || (!!product && !isDirty)}>
                  {busy ? t('editor.actions.saving') : t('editor.actions.save')}
                </Button>
              </div>
            </div>
            {mutation.isSuccess && !isDirty && (
              <p role="status" className="text-small text-success">
                {t('editor.saved')}
              </p>
            )}
          </header>

          {mutation.isError && (
            <div className="flex flex-col gap-3">
              <ErrorBanner>{forError(mutation.error)}</ErrorBanner>
              {stale && (
                <div>
                  <Button type="button" size="sm" onClick={() => void reloadLatest()}>
                    {t('editor.actions.reload')}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className={cn('grid grid-cols-1 items-start gap-6', columns)}>
            <div className="flex min-w-0 flex-col gap-6">
              <BasicDetailsCard />
              <PhotosCard product={product} />
              <VariantsCard product={product} />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <StatusCard />
              <OrganisationCard />
              <StockSummaryCard />
            </div>
          </div>
        </form>
      </Form>

      <AlertDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.leave.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('editor.leave.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              {t('editor.leave.stay')}
            </AlertDialogCancel>
            <Button type="button" variant="danger" onClick={() => blocker.proceed?.()}>
              {t('editor.leave.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BasicDetailsCard() {
  const { t } = useTranslation('catalog');

  return (
    <section className={card}>
      <h2 className="text-heading">{t('basics.title')}</h2>
      <FormField
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('basics.name')}</FormLabel>
            <FormControl>
              <Input autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('basics.description')}</FormLabel>
            <FormControl>
              <Textarea rows={3} {...field} />
            </FormControl>
            <FormDescription>{t('basics.descriptionHint')}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </section>
  );
}

function StatusCard() {
  const { t } = useTranslation('catalog');
  const { productStatus } = useStatusLabels();

  return (
    <section className={card}>
      <FormField
        name="status"
        render={({ field }) => (
          <FormItem className="gap-4">
            <h2 className="text-heading">
              <FormLabel className="text-heading">{t('status.title')}</FormLabel>
            </h2>
            <div className="relative flex items-center">
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute left-3.5 size-2 rounded-full',
                  field.value === 'active' ? 'bg-success' : 'bg-ink-muted',
                )}
              />
              <FormControl>
                <select
                  {...field}
                  className="h-10 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-border-strong bg-surface pr-10 pl-8 text-body text-ink"
                >
                  {productStatusSchema.options.map((status) => (
                    <option key={status} value={status}>
                      {productStatus(status)}
                    </option>
                  ))}
                </select>
              </FormControl>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-3 size-4 text-ink-muted"
                strokeWidth={1.5}
              />
            </div>
            <FormDescription>{t('status.hint')}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </section>
  );
}

function OrganisationCard() {
  const { t } = useTranslation('catalog');
  const labelId = useId();

  return (
    <section className={card}>
      <h2 className="text-heading">{t('organisation.title')}</h2>
      <FormField
        name="categoryIds"
        render={({ field }) => (
          <div role="group" aria-labelledby={labelId} className="flex min-w-0 flex-col gap-2">
            <span id={labelId} className="text-label">
              {t('organisation.categories')}
            </span>
            <CategoryPicker value={field.value} onChange={field.onChange} labelId={labelId} />
          </div>
        )}
      />
      <FormField
        name="aliases"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('organisation.aliases')}</FormLabel>
            <FormControl>
              <CommaListInput
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
                autoComplete="off"
              />
            </FormControl>
            <FormDescription>{t('organisation.aliasesHint')}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </section>
  );
}

function StockSummaryCard() {
  const { t } = useTranslation('catalog');
  const variants = useWatch<ProductFormValues, 'variants'>({ name: 'variants' });
  const total = variants.reduce((sum, v) => sum + (Number.isNaN(v.stock) ? 0 : v.stock), 0);
  const outOfStock = variants.filter((v) => v.stock === 0).length;

  return (
    <section className={card}>
      <h2 className="text-heading">{t('stock.title')}</h2>
      <dl className="flex flex-col gap-2 text-body">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">{t('stock.total')}</dt>
          <dd className="font-semibold tabular-nums">{total}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">{t('stock.outOfStock')}</dt>
          <dd className="tabular-nums">
            {t('stock.variantsOf', { count: outOfStock, total: variants.length })}
          </dd>
        </div>
      </dl>
    </section>
  );
}
