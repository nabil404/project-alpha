import type { ProductOptionInput, ProductVariantInput } from '@app/shared';
import { productImageNotFound, productOptionNotFound, variantNotFound } from '../product-errors';
import { normalizeSku } from '../sku';

/**
 * What a save document turns into, worked out without touching the database:
 * which rows go, which stay (by id), and what every surviving or new row
 * should hold. The document must already have passed the shared schema, whose
 * refinements guarantee every variant value exists; ProductWriter applies the
 * result.
 */

export interface CurrentProductState {
  options: { id: string; values: { id: string }[] }[];
  variantIds: string[];
  /** Gallery order. */
  imageIds: string[];
}

export const EMPTY_PRODUCT_STATE: CurrentProductState = {
  options: [],
  variantIds: [],
  imageIds: [],
};

export interface ProductDocumentInput {
  options: ProductOptionInput[];
  variants: ProductVariantInput[];
  /** Undefined on create, which has no images yet. */
  coverImageId?: string | null;
}

export interface PlannedValue {
  id: string | null;
  value: string;
  position: number;
}

export interface PlannedOption {
  id: string | null;
  name: string;
  position: number;
  values: PlannedValue[];
}

export interface PlannedVariant {
  id: string | null;
  name: string | null;
  /** Normalized. Null: generate one for a new variant, keep the current one for an existing variant. */
  sku: string | null;
  price: number;
  stock: number;
  imageId: string | null;
  /** One per option, in order: indexes into plan.options and that option's values. */
  valueRefs: { option: number; value: number }[];
}

export interface ProductDocumentPlan {
  archiveVariantIds: string[];
  deleteOptionIds: string[];
  /** Values dropped from options that survive; a deleted option's values go with it. */
  deleteValueIds: string[];
  options: PlannedOption[];
  variants: PlannedVariant[];
  /** Undefined: leave as it is. */
  coverImageId: string | null | undefined;
}

const sameText = (text: string) => text.trim().toLowerCase();

/** The variant's display name, which order lines and the assistant read. */
export function variantLabel(values: string[]): string | null {
  return values.length === 0 ? null : values.join(' / ');
}

export function planProductDocument(
  current: CurrentProductState,
  doc: ProductDocumentInput,
): ProductDocumentPlan {
  const storedValues = new Map(
    current.options.map((o) => [o.id, new Set(o.values.map((v) => v.id))]),
  );

  const options: PlannedOption[] = doc.options.map((option, position) => {
    // A new option owns no values yet, so any value id under it is foreign.
    const own = option.id === undefined ? new Set<string>() : storedValues.get(option.id);
    if (!own) throw productOptionNotFound(option.id!);
    return {
      id: option.id ?? null,
      name: option.name,
      position,
      values: option.values.map((value, valuePosition) => {
        if (value.id !== undefined && !own.has(value.id)) throw productOptionNotFound(value.id);
        return { id: value.id ?? null, value: value.value, position: valuePosition };
      }),
    };
  });

  const keptOptions = new Set(options.flatMap((o) => (o.id ? [o.id] : [])));
  const keptValues = new Set(options.flatMap((o) => o.values.flatMap((v) => (v.id ? [v.id] : []))));
  const deleteOptionIds = current.options.filter((o) => !keptOptions.has(o.id)).map((o) => o.id);
  const deleteValueIds = current.options
    .filter((o) => keptOptions.has(o.id))
    .flatMap((o) => o.values.filter((v) => !keptValues.has(v.id)).map((v) => v.id));

  const liveVariants = new Set(current.variantIds);
  const images = new Set(current.imageIds);
  const variants: PlannedVariant[] = doc.variants.map((variant) => {
    if (variant.id !== undefined && !liveVariants.has(variant.id)) {
      throw variantNotFound(variant.id);
    }
    if (variant.imageId !== null && !images.has(variant.imageId)) {
      throw productImageNotFound(variant.imageId);
    }
    const valueRefs = variant.optionValues.map((text, option) => {
      const value =
        options[option]?.values.findIndex((v) => sameText(v.value) === sameText(text)) ?? -1;
      if (value < 0) {
        throw new Error('planProductDocument needs a document the schema has validated');
      }
      return { option, value };
    });
    return {
      id: variant.id ?? null,
      name: variantLabel(valueRefs.map((ref) => options[ref.option]!.values[ref.value]!.value)),
      sku: normalizeSku(variant.sku),
      price: variant.price,
      stock: variant.stock,
      imageId: variant.imageId,
      valueRefs,
    };
  });

  const keptVariants = new Set(variants.flatMap((v) => (v.id ? [v.id] : [])));
  const archiveVariantIds = current.variantIds.filter((id) => !keptVariants.has(id));

  let coverImageId: string | null | undefined;
  if (doc.coverImageId !== undefined) {
    if (doc.coverImageId !== null && !images.has(doc.coverImageId)) {
      throw productImageNotFound(doc.coverImageId);
    }
    coverImageId = doc.coverImageId ?? current.imageIds[0] ?? null;
  }

  return { archiveVariantIds, deleteOptionIds, deleteValueIds, options, variants, coverImageId };
}
