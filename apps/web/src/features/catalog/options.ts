import type { OptionDraft, VariantDraft } from './product-form';

/**
 * How the option editor reshapes the variants. Every function here is pure and
 * returns the next `options` and `variants`; nothing reaches the API until the
 * page is saved, so Discard undoes all of it.
 *
 * A kept variant keeps its id, SKU and stock (orders and the assistant already
 * know it); a new one copies its price and image from the variant it grew
 * from, starts at zero stock and gets its SKU from the API. A name the seller
 * gave survives a value's rename but not a change of options, which changes
 * what the variant is.
 */
export interface OptionState {
  options: OptionDraft[];
  variants: VariantDraft[];
}

/** Values compare trimmed and case-insensitively, as the shared schema does. */
export const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const comboKey = (values: string[]) => values.map((v) => v.trim().toLowerCase()).join('\u0000');

/** What the variant is called if the seller doesn't name it. */
export const valuesLabel = (variant: VariantDraft) => variant.optionValues.join(' / ');

export const variantLabel = (variant: VariantDraft) => variant.name.trim() || valuesLabel(variant);

function grownFrom(template: VariantDraft, optionValues: string[]): VariantDraft {
  return {
    name: '',
    optionValues,
    sku: '',
    price: template.price,
    stock: 0,
    imageId: template.imageId,
  };
}

/** Each current variant times each of the new option's values. */
export function addOption({ options, variants }: OptionState, option: OptionDraft): OptionState {
  return {
    options: [...options, option],
    variants: variants.flatMap((variant) =>
      option.values.map(({ value }, index) =>
        index === 0
          ? { ...variant, name: '', optionValues: [...variant.optionValues, value] }
          : grownFrom(variant, [...variant.optionValues, value]),
      ),
    ),
  };
}

/** How many variants adding `option` would leave. */
export const countAfterAdding = (variants: VariantDraft[], option: OptionDraft) =>
  variants.length * option.values.length;

/**
 * Drops the option from every variant. Variants that become the same
 * combination collapse into the first of them; with no options left, one
 * variant remains.
 */
export function removeOption({ options, variants }: OptionState, index: number): OptionState {
  const seen = new Set<string>();
  const kept: VariantDraft[] = [];
  for (const variant of variants) {
    const optionValues = variant.optionValues.filter((_, i) => i !== index);
    const key = comboKey(optionValues);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...variant, name: '', optionValues });
  }
  return { options: options.filter((_, i) => i !== index), variants: kept };
}

/**
 * Replaces option `index` with its edited copy. Variants using a removed value
 * go; variants using a renamed value follow it. New values add a variant each
 * only while this is the product's one option: with more, the seller adds the
 * combinations they sell.
 */
export function updateOption(state: OptionState, index: number, edited: OptionDraft): OptionState {
  const before = state.options[index]!;
  const renamed = new Map<string, string>();
  const removed: string[] = [];

  for (const old of before.values) {
    const match = old.id
      ? edited.values.find((v) => v.id === old.id)
      : edited.values.find((v) => !v.id && sameText(v.value, old.value));
    if (!match) removed.push(old.value);
    else if (match.value !== old.value) renamed.set(old.value.trim().toLowerCase(), match.value);
  }

  let variants = state.variants
    .filter((variant) => !removed.some((text) => sameText(variant.optionValues[index]!, text)))
    .map((variant) => {
      const to = renamed.get(variant.optionValues[index]!.trim().toLowerCase());
      return to === undefined
        ? variant
        : { ...variant, optionValues: variant.optionValues.map((v, i) => (i === index ? to : v)) };
    });

  if (state.options.length === 1) {
    const added = edited.values.filter(
      (v) => !variants.some((variant) => sameText(variant.optionValues[0]!, v.value)),
    );
    const template = variants[0] ?? state.variants[0]!;
    variants = [...variants, ...added.map((v) => grownFrom(template, [v.value]))];
  }

  const options = state.options.map((option, i) => (i === index ? edited : option));
  return { options, variants };
}

/** Removing an option's last value removes the option. */
export function removeValue(state: OptionState, optionIndex: number, valueIndex: number) {
  const option = state.options[optionIndex]!;
  if (option.values.length === 1) return removeOption(state, optionIndex);
  return updateOption(state, optionIndex, {
    ...option,
    values: option.values.filter((_, i) => i !== valueIndex),
  });
}

export function addValue(state: OptionState, optionIndex: number, value: string) {
  const option = state.options[optionIndex]!;
  return updateOption(state, optionIndex, { ...option, values: [...option.values, { value }] });
}

/** Every combination of the options' values that no variant has yet, in option order. */
export function missingCombinations({ options, variants }: OptionState): string[][] {
  if (options.length === 0) return [];
  const existing = new Set(variants.map((v) => comboKey(v.optionValues)));
  const all = options.reduce<string[][]>(
    (combos, option) => combos.flatMap((combo) => option.values.map((v) => [...combo, v.value])),
    [[]],
  );
  return all.filter((combo) => !existing.has(comboKey(combo)));
}

export function addCombinations(state: OptionState, combos: string[][]): OptionState {
  const template = state.variants[0]!;
  return {
    options: state.options,
    variants: [
      ...state.variants,
      ...combos.map((combo) => ({ ...grownFrom(template, combo), imageId: null })),
    ],
  };
}

export function hasCombination({ variants }: OptionState, combo: string[]) {
  const key = comboKey(combo);
  return variants.some((v) => comboKey(v.optionValues) === key);
}
