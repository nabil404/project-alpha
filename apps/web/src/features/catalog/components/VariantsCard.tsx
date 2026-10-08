import { useId, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useFieldArray, useFormContext, useWatch, type FieldErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  PRODUCT_OPTION_MAX_COUNT,
  VARIANT_NAME_MAX_LENGTH,
  productOptionInputSchema,
  type Product,
} from '@app/shared';

import { Button } from '@/components/ui/button';
import { FormControl, FormField, FormItem, FormMessage, useFormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import {
  addCombinations,
  addOption,
  addValue,
  hasCombination,
  missingCombinations,
  removeOption,
  removeValue,
  sameText,
  updateOption,
  valuesLabel,
  variantLabel,
  type OptionState,
} from '../options';
import type { OptionDraft, ProductFormValues } from '../product-form';
import { AddOptionMenu } from './AddOptionMenu';
import { MoneyInput } from './MoneyInput';
import { OptionPanel } from './OptionPanel';
import { VariantImagePicker } from './VariantImagePicker';

const optionValueSchema = productOptionInputSchema.shape.values.element.shape.value;

type Panel = { kind: 'new'; name: string } | { kind: 'edit'; index: number } | null;

/**
 * Options and the variants they make. Each option change reshapes the
 * variant rows in the form (see options.ts); the page's Save writes it all.
 */
export function VariantsCard({ product }: { product?: Product }) {
  const { t } = useTranslation(['catalog', 'common']);
  const form = useFormContext<ProductFormValues>();
  const { fields, replace, remove } = useFieldArray({
    control: form.control,
    name: 'variants',
    keyName: 'key',
  });
  const options = useWatch({ control: form.control, name: 'options' });
  const variants = useWatch({ control: form.control, name: 'variants' });
  const [panel, setPanel] = useState<Panel>(null);

  const state: OptionState = { options, variants };
  const single = options.length === 1 ? options[0]! : null;

  const apply = (next: OptionState) => {
    form.setValue('options', next.options, { shouldDirty: true });
    replace(next.variants);
    if (form.formState.isSubmitted) void form.trigger(['options', 'variants']);
    // An edit panel points at an option by position, which this may have moved.
    setPanel((open) => (open?.kind === 'edit' ? null : open));
  };

  const onPanelSubmit = (option: OptionDraft) => {
    if (panel?.kind === 'edit') apply(updateOption(state, panel.index, option));
    else apply(addOption(state, option));
    setPanel(null);
  };

  const variantColumn = single ? single.name : t('variants.variant');

  return (
    <section className="relative flex flex-col rounded-lg border border-border bg-surface shadow-card">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
            <h2 className="text-heading">{t('variants.title')}</h2>
            <p className="text-body text-ink-muted">
              {options.length === 0
                ? t('variants.descriptionNone')
                : options.length === 1
                  ? t('variants.descriptionOne', { option: single!.name.toLowerCase() })
                  : t('variants.descriptionMany')}
            </p>
          </div>
          {/* Past the heading's 24px line and the 2px gap: level with the description's first line. */}
          <div className="mt-6.5">
            <AddOptionMenu
              taken={options.map((o) => o.name)}
              onChoose={(name) => setPanel({ kind: 'new', name })}
            />
          </div>
        </div>

        {single && (
          <SingleOption
            option={single}
            onEdit={() => setPanel({ kind: 'edit', index: 0 })}
            onRemoveValue={(valueIndex) => apply(removeValue(state, 0, valueIndex))}
            onAddValue={(value) => apply(addValue(state, 0, value))}
          />
        )}
        {options.length > 1 && (
          <OptionList
            options={options}
            variantCount={variants.length}
            onEdit={(index) => setPanel({ kind: 'edit', index })}
            onRemove={(index) => apply(removeOption(state, index))}
          />
        )}
        <OptionErrors errors={form.formState.errors} count={options.length} />

        {panel && (
          <OptionPanel
            key={panel.kind === 'edit' ? `edit-${panel.index}` : `new-${panel.name}`}
            editing={
              panel.kind === 'edit'
                ? { index: panel.index, option: options[panel.index]! }
                : undefined
            }
            initialName={panel.kind === 'new' ? panel.name : undefined}
            state={state}
            onCancel={() => setPanel(null)}
            onSubmit={onPanelSubmit}
          />
        )}
      </div>

      {/* Relative: the sr-only header is absolute, and must scroll with the table, not widen the page. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-160 border-collapse">
          <thead>
            <tr className="text-left text-label text-ink-muted">
              <th scope="col" className="border-b border-border py-3 pr-3 pl-6 font-medium">
                {t('variants.image')}
              </th>
              <th scope="col" className="border-b border-border px-3 py-3 font-medium">
                {variantColumn}
              </th>
              <th scope="col" className="border-b border-border px-3 py-3 font-medium">
                {t('variants.price')}
              </th>
              <th scope="col" className="border-b border-border px-3 py-3 font-medium">
                {t('variants.stock')}
              </th>
              <th scope="col" className="border-b border-border px-3 py-3 font-medium">
                {t('variants.sku')}
              </th>
              <th scope="col" className="border-b border-border py-3 pr-6 pl-2">
                <span className="sr-only">{t('variants.remove')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const variant = variants[index] ?? field;
              const label = variantLabel(variant) || t('variants.only');
              return (
                <tr key={field.key} className="align-top">
                  <td className="border-t border-border py-3 pr-3 pl-6">
                    <FormField
                      control={form.control}
                      name={`variants.${index}.imageId`}
                      render={({ field: imageField }) => (
                        <VariantImagePicker
                          product={product}
                          value={imageField.value}
                          onChange={(imageId) => imageField.onChange(imageId)}
                          variant={label}
                        />
                      )}
                    />
                  </td>
                  <th
                    scope="row"
                    className="border-t border-border px-3 py-3 text-left text-body font-medium whitespace-nowrap"
                  >
                    {options.length === 0 ? (
                      <span className="flex h-12 items-center">{label}</span>
                    ) : (
                      <FormField
                        control={form.control}
                        name={`variants.${index}.name`}
                        render={({ field: nameField }) => (
                          <FormItem className="w-36 pt-1">
                            <FormControl>
                              <Input
                                aria-label={t('variants.nameFor', {
                                  variant: valuesLabel(variant),
                                })}
                                placeholder={valuesLabel(variant)}
                                maxLength={VARIANT_NAME_MAX_LENGTH}
                                autoComplete="off"
                                className="font-medium"
                                {...nameField}
                              />
                            </FormControl>
                            {options.length > 1 && (
                              <span className="truncate text-small font-normal text-ink-muted">
                                {options
                                  .map((option, i) => `${option.name} ${variant.optionValues[i]}`)
                                  .join(' · ')}
                              </span>
                            )}
                            <FormMessage className="font-normal whitespace-normal" />
                          </FormItem>
                        )}
                      />
                    )}
                    <RowError index={index} />
                  </th>
                  <td className="border-t border-border px-3 py-3">
                    <FormField
                      control={form.control}
                      name={`variants.${index}.price`}
                      render={({ field: priceField }) => (
                        <FormItem className="w-32 pt-1">
                          <FormControl>
                            <MoneyInput
                              aria-label={t('variants.priceFor', { variant: label })}
                              value={priceField.value}
                              onChange={priceField.onChange}
                              onBlur={priceField.onBlur}
                              name={priceField.name}
                              ref={priceField.ref}
                            />
                          </FormControl>
                          <NumberMessage invalid={Number.isNaN(priceField.value)} kind="price" />
                        </FormItem>
                      )}
                    />
                  </td>
                  <td className="border-t border-border px-3 py-3">
                    <FormField
                      control={form.control}
                      name={`variants.${index}.stock`}
                      render={({ field: stockField }) => (
                        <FormItem className="pt-1">
                          <FormControl>
                            <Input
                              aria-label={t('variants.stockFor', { variant: label })}
                              inputMode="numeric"
                              className="w-20 tabular-nums"
                              name={stockField.name}
                              ref={stockField.ref}
                              onBlur={stockField.onBlur}
                              value={Number.isNaN(stockField.value) ? '' : stockField.value}
                              onChange={(event) =>
                                stockField.onChange(
                                  /^\d+$/.test(event.target.value.trim())
                                    ? Number(event.target.value)
                                    : Number.NaN,
                                )
                              }
                            />
                          </FormControl>
                          <NumberMessage invalid={Number.isNaN(stockField.value)} kind="stock" />
                        </FormItem>
                      )}
                    />
                  </td>
                  <td className="border-t border-border px-3 py-3">
                    <FormField
                      control={form.control}
                      name={`variants.${index}.sku`}
                      render={({ field: skuField }) => (
                        <FormItem className="min-w-36 pt-1">
                          <FormControl>
                            <Input
                              aria-label={t('variants.skuFor', { variant: label })}
                              placeholder={t('variants.skuPlaceholder')}
                              className="font-mono text-code"
                              autoComplete="off"
                              {...skuField}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </td>
                  <td className="border-t border-border py-3 pr-6 pl-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-1 text-ink-muted"
                      aria-label={t('variants.removeVariant', { variant: label })}
                      title={t('variants.remove')}
                      disabled={fields.length === 1}
                      onClick={() => remove(index)}
                    >
                      <Trash2 aria-hidden strokeWidth={1.5} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {options.length > 0 && (
        <AddCombination state={state} onAdd={(combos) => apply(addCombinations(state, combos))} />
      )}
      <VariantsRootError />
    </section>
  );
}

function SingleOption({
  option,
  onEdit,
  onRemoveValue,
  onAddValue,
}: {
  option: OptionDraft;
  onEdit: () => void;
  onRemoveValue: (index: number) => void;
  onAddValue: (value: string) => void;
}) {
  const { t } = useTranslation('catalog');
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const taken = option.values.some((v) => sameText(v.value, text));

  // Blank, taken or too long: nothing is added, as if the seller pressed Escape.
  const commit = () => {
    if (!taken && optionValueSchema.safeParse(text).success) onAddValue(text.trim());
    setText('');
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-label">{option.name}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-ink-muted"
          aria-label={t('options.edit', { name: option.name })}
          title={t('options.editShort')}
          onClick={onEdit}
        >
          <Pencil aria-hidden strokeWidth={1.5} />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {option.values.map((v, i) => (
          <span
            key={v.id ?? `new-${v.value}`}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-sunken pr-1 pl-3 text-label"
          >
            {v.value}
            <button
              type="button"
              aria-label={t('options.removeValue', { value: v.value })}
              className="flex size-6 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover"
              onClick={() => onRemoveValue(i)}
            >
              <X aria-hidden className="size-3.5" strokeWidth={1.5} />
            </button>
          </span>
        ))}
        {adding ? (
          <span className="flex flex-col gap-1">
            <input
              autoFocus
              aria-label={t('options.addValue', { option: option.name.toLowerCase() })}
              aria-invalid={taken}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commit();
                } else if (event.key === 'Escape') {
                  setText('');
                  setAdding(false);
                }
              }}
              onBlur={commit}
              className="h-8 w-32 rounded-full border border-accent bg-surface px-3 text-label text-ink aria-invalid:border-danger"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-dashed border-accent px-3 text-label text-accent hover:bg-accent-soft"
          >
            <Plus aria-hidden className="size-3.5" strokeWidth={1.5} />
            {t('options.addValue', { option: option.name.toLowerCase() })}
          </button>
        )}
      </div>
      {adding && taken && (
        <p className="text-small text-danger">{t('options.valueTaken', { value: text.trim() })}</p>
      )}
    </div>
  );
}

function OptionList({
  options,
  variantCount,
  onEdit,
  onRemove,
}: {
  options: OptionDraft[];
  variantCount: number;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation('catalog');

  return (
    <div className="flex flex-col gap-2">
      <span className="text-label">{t('options.title')}</span>
      <ul className="flex flex-col gap-2">
        {options.map((option, index) => (
          <li
            key={option.id ?? `new-${option.name}`}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
          >
            <span className="w-24 shrink-0 truncate text-body font-medium">{option.name}</span>
            <span className="flex min-w-0 grow flex-wrap gap-1.5">
              {option.values.map((v) => (
                <span
                  key={v.id ?? v.value}
                  className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-label"
                >
                  {v.value}
                </span>
              ))}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-ink-muted"
              aria-label={t('options.edit', { name: option.name })}
              title={t('options.editShort')}
              onClick={() => onEdit(index)}
            >
              <Pencil aria-hidden strokeWidth={1.5} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-ink-muted"
              aria-label={t('options.remove', { name: option.name })}
              title={t('options.removeShort')}
              onClick={() => onRemove(index)}
            >
              <Trash2 aria-hidden strokeWidth={1.5} />
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-small text-ink-muted">
        {t('options.used', { count: options.length, max: PRODUCT_OPTION_MAX_COUNT })}
        {' · '}
        {t('options.variantCount', { count: variantCount })}
      </p>
    </div>
  );
}

function AddCombination({
  state,
  onAdd,
}: {
  state: OptionState;
  onAdd: (combos: string[][]) => void;
}) {
  const { t } = useTranslation('catalog');
  const id = useId();
  const [picked, setPicked] = useState<string[]>([]);
  // A pick whose value was since removed falls back to the option's first value.
  const combo = state.options.map((option, i) =>
    option.values.some((v) => v.value === picked[i]) ? picked[i]! : (option.values[0]?.value ?? ''),
  );
  const exists = hasCombination(state, combo);
  const missing = missingCombinations(state);
  const optionName = state.options[0]!.name.toLowerCase();

  return (
    <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
      <div className="flex flex-wrap items-end gap-3">
        {state.options.map((option, i) => (
          <div key={option.id ?? option.name} className="flex flex-col gap-2">
            <label htmlFor={`${id}-${i}`} className="text-label">
              {option.name}
            </label>
            <Select
              id={`${id}-${i}`}
              value={combo[i] ?? ''}
              onValueChange={(chosen) => {
                const next = [...combo];
                next[i] = chosen;
                setPicked(next);
              }}
              options={option.values.map((v) => ({ value: v.value, label: v.value }))}
              className="min-w-28"
            />
          </div>
        ))}
        <Button type="button" disabled={exists} onClick={() => onAdd([combo])}>
          <Plus aria-hidden strokeWidth={1.5} />
          {t('variants.addVariant')}
        </Button>
        <span className="grow" />
        {missing.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="text-accent"
            onClick={() => onAdd(missing)}
          >
            {t('variants.addMissing', { count: missing.length })}
          </Button>
        )}
      </div>
      <p className="text-small text-ink-muted">
        {state.options.length === 1
          ? missing.length > 0
            ? t('variants.missingOne', { option: optionName, list: missing.join(', ') })
            : t('variants.noneMissingOne', { option: optionName })
          : missing.length > 0
            ? t('variants.missing', { list: missing.map((c) => c.join(' / ')).join(', ') })
            : t('variants.noneMissing')}
      </p>
    </div>
  );
}

/** An amount or count field holding text that isn't one: say so plainly, not "expected number". */
function NumberMessage({ invalid, kind }: { invalid: boolean; kind: 'price' | 'stock' }) {
  const { t } = useTranslation('catalog');
  const { error, formMessageId } = useFormField();
  if (!error) return null;

  return (
    <p id={formMessageId} className="text-small text-danger">
      {invalid
        ? kind === 'price'
          ? t('variants.priceInvalid')
          : t('variants.stockInvalid')
        : error.message}
    </p>
  );
}

/** Errors about a variant's combination, not one of its fields. */
function RowError({ index }: { index: number }) {
  const { formState } = useFormContext<ProductFormValues>();
  const error = formState.errors.variants?.[index]?.optionValues;
  const message =
    error?.message ?? (Array.isArray(error) ? error.find(Boolean)?.message : undefined);
  return message ? <p className="text-small font-normal text-danger">{message}</p> : null;
}

function VariantsRootError() {
  const { formState } = useFormContext<ProductFormValues>();
  const message = formState.errors.variants?.root?.message ?? formState.errors.variants?.message;
  return message ? (
    <p role="alert" className="border-t border-border px-6 py-3 text-small text-danger">
      {message}
    </p>
  ) : null;
}

/** Option name and value errors, from the schema or the API. */
function OptionErrors({
  errors,
  count,
}: {
  errors: FieldErrors<ProductFormValues>;
  count: number;
}) {
  const messages: string[] = [];
  for (let i = 0; i < count; i++) {
    const option = errors.options?.[i];
    if (!option) continue;
    if (option.name?.message) messages.push(option.name.message);
    const values = option.values;
    if (values?.message) messages.push(values.message);
    if (Array.isArray(values)) {
      for (const value of values) if (value?.value?.message) messages.push(value.value.message);
    }
  }
  if (errors.options?.message) messages.push(errors.options.message);

  return messages.length > 0 ? (
    <ul role="alert" className="flex flex-col gap-1 text-small text-danger">
      {[...new Set(messages)].map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  ) : null;
}
