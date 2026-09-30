import { useId, useState, type KeyboardEvent } from 'react';
import { Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  PRODUCT_OPTION_VALUE_MAX_COUNT,
  PRODUCT_VARIANT_MAX_COUNT,
  describeZodIssue,
  productOptionInputSchema,
} from '@app/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useErrorMessages } from '@/i18n/error-keys';

import { addOption, sameText, variantLabel, type OptionState } from '../options';
import type { OptionDraft } from '../product-form';

const nameSchema = productOptionInputSchema.shape.name;
const valueSchema = productOptionInputSchema.shape.values.element.shape.value;
const PREVIEWED = 4;

interface OptionPanelProps {
  /** Absent: a new option. */
  editing?: { index: number; option: OptionDraft };
  initialName?: string;
  state: OptionState;
  onCancel: () => void;
  onSubmit: (option: OptionDraft) => void;
}

/**
 * Names an option and its values. Nothing changes on the page until the
 * panel's own button; the page's Save then writes it with everything else.
 */
export function OptionPanel({
  editing,
  initialName = '',
  state,
  onCancel,
  onSubmit,
}: OptionPanelProps) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forCode } = useErrorMessages();
  const id = useId();
  const [name, setName] = useState(editing?.option.name ?? initialName);
  const [values, setValues] = useState(editing?.option.values ?? []);
  const [draftValue, setDraftValue] = useState('');
  const [valueError, setValueError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const others = state.options.filter((_, i) => i !== editing?.index);
  const draft: OptionDraft = { ...editing?.option, name: name.trim(), values };

  const nameIssue = nameSchema.safeParse(name).error?.issues[0];
  const nameError = nameIssue
    ? forCode(describeZodIssue(nameIssue).code, describeZodIssue(nameIssue).params)
    : others.some((o) => sameText(o.name, name))
      ? t('options.nameTaken')
      : null;
  const valuesError = values.length === 0 ? t('options.valuesRequired') : null;

  const preview = editing ? null : addOption(state, draft).variants;
  const tooMany = preview !== null && preview.length > PRODUCT_VARIANT_MAX_COUNT;

  const addDraftValue = () => {
    const text = draftValue.trim();
    if (!text) return;
    const issue = valueSchema.safeParse(text).error?.issues[0];
    if (issue) {
      const { code, params } = describeZodIssue(issue);
      setValueError(forCode(code, params));
    } else if (values.some((v) => sameText(v.value, text))) {
      setValueError(t('options.valueTaken', { value: text }));
    } else if (values.length >= PRODUCT_OPTION_VALUE_MAX_COUNT) {
      setValueError(t('options.tooManyValues', { max: PRODUCT_OPTION_VALUE_MAX_COUNT }));
    } else {
      setValues([...values, { value: text }]);
      setDraftValue('');
      setValueError(null);
    }
  };

  const onValueKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter adds a value; it must not submit the product form.
      event.preventDefault();
      addDraftValue();
    } else if (event.key === 'Backspace' && draftValue === '' && values.length > 0) {
      setValues(values.slice(0, -1));
    }
  };

  const submit = () => {
    setSubmitted(true);
    if (nameError || valuesError || tooMany) return;
    onSubmit(draft);
  };

  const title = editing
    ? t('options.editTitle', { name: editing.option.name })
    : t('options.newTitle');

  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-sunken p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-heading">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-ink-muted"
          aria-label={t('options.discard')}
          onClick={onCancel}
        >
          <X aria-hidden strokeWidth={1.5} />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor={`${id}-name`}>{t('options.name')}</Label>
          <Input
            id={`${id}-name`}
            value={name}
            aria-invalid={submitted && !!nameError}
            aria-describedby={`${id}-name-hint`}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
          <p
            id={`${id}-name-hint`}
            className={
              submitted && nameError ? 'text-small text-danger' : 'text-small text-ink-muted'
            }
          >
            {submitted && nameError ? nameError : t('options.nameHint')}
          </p>
        </div>

        <div className="grid content-start gap-2">
          <Label htmlFor={`${id}-values`}>{t('options.values')}</Label>
          <div
            className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
              submitted && valuesError ? 'border-danger' : 'border-border-strong'
            }`}
          >
            {values.map((v, i) => (
              <span
                key={v.id ?? `new-${v.value}`}
                className="inline-flex h-7 items-center gap-0.5 rounded-full bg-surface-sunken pr-0.5 pl-2.5 text-label"
              >
                {v.value}
                <button
                  type="button"
                  aria-label={t('options.removeValue', { value: v.value })}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover"
                  onClick={() => setValues(values.filter((_, j) => j !== i))}
                >
                  <X aria-hidden className="size-3.5" strokeWidth={1.5} />
                </button>
              </span>
            ))}
            <input
              id={`${id}-values`}
              value={draftValue}
              placeholder={t('options.valuePlaceholder')}
              aria-invalid={!!valueError || (submitted && !!valuesError)}
              aria-describedby={`${id}-values-hint`}
              className="h-7 min-w-32 grow bg-transparent px-1 text-body text-ink outline-none placeholder:text-ink-muted"
              onChange={(event) => {
                setDraftValue(event.target.value);
                setValueError(null);
              }}
              onKeyDown={onValueKeyDown}
              onBlur={addDraftValue}
            />
          </div>
          <p
            id={`${id}-values-hint`}
            className={
              valueError || (submitted && valuesError)
                ? 'text-small text-danger'
                : 'text-small text-ink-muted'
            }
          >
            {valueError ?? (submitted && valuesError ? valuesError : t('options.valuesHint'))}
          </p>
        </div>
      </div>

      {preview && values.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-3">
          <p className="flex items-start gap-2 text-small">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.5} />
            <span className={tooMany ? 'text-danger' : undefined}>
              {tooMany
                ? t('options.tooManyVariants', { max: PRODUCT_VARIANT_MAX_COUNT })
                : t('options.makesVariants', { count: preview.length })}
            </span>
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {preview.slice(0, PREVIEWED).map((variant) => (
              <li
                key={variantLabel(variant)}
                className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-label"
              >
                {variantLabel(variant)}
              </li>
            ))}
            {preview.length > PREVIEWED && (
              <li className="px-1 py-0.5 text-label text-ink-muted">
                {t('options.moreVariants', { count: preview.length - PREVIEWED })}
              </li>
            )}
          </ul>
          <p className="text-small text-ink-muted">{t('options.newVariantsHint')}</p>
        </div>
      )}
      {editing && <p className="text-small text-ink-muted">{t('options.editHint')}</p>}

      <div className="flex justify-end gap-3">
        <Button type="button" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button type="button" variant="primary" onClick={submit}>
          {editing ? t('options.apply') : t('options.add')}
        </Button>
      </div>
    </section>
  );
}
