import type { CreateProduct, Product, ProductDeliveryCharge, ProductStatus } from '@app/shared';

/**
 * The edit page's form: the product document the API saves, with every
 * default filled in so controls never see `undefined`. It is a valid input to
 * `createProductSchema`; Save adds `version` and `coverImageId` on top.
 */
export interface OptionDraft {
  id?: string;
  name: string;
  values: { id?: string; value: string }[];
}

export interface VariantDraft {
  id?: string;
  /** Blank: the variant is called by its values ("M / Short"). */
  name: string;
  /** One value's text per option, in the options' order. */
  optionValues: string[];
  /** Blank: the API generates one. */
  sku: string;
  /** Minor units; NaN while the field holds something that isn't an amount. */
  price: number;
  stock: number;
  imageId: string | null;
}

export interface ProductFormValues {
  name: string;
  description: string;
  status: ProductStatus;
  aliases: string[];
  /** False: the shop's delivery charges. True: `deliveryCharges`, the shop's where it sets none. */
  customDelivery: boolean;
  deliveryCharges: ProductDeliveryCharge[];
  categoryIds: string[];
  /**
   * The default photo, chosen in All photos. Not part of the create schema, so
   * validation drops it; Save reads it from the form and sends it alongside.
   */
  coverImageId: string | null;
  options: OptionDraft[];
  variants: VariantDraft[];
}

export const emptyProduct: ProductFormValues = {
  name: '',
  description: '',
  status: 'draft',
  aliases: [],
  customDelivery: false,
  deliveryCharges: [],
  categoryIds: [],
  coverImageId: null,
  options: [],
  variants: [{ name: '', optionValues: [], sku: '', price: 0, stock: 0, imageId: null }],
};

export function toFormValues(product: Product): ProductFormValues {
  const valueText = new Map(
    product.options.flatMap((option) => option.values.map((v) => [v.id, v.value] as const)),
  );

  return {
    name: product.name,
    description: product.description ?? '',
    status: product.status,
    aliases: product.aliases,
    customDelivery: product.customDelivery,
    deliveryCharges: product.deliveryCharges,
    categoryIds: product.categoryIds,
    coverImageId: product.coverImageId,
    options: product.options.map((option) => ({
      id: option.id,
      name: option.name,
      values: option.values.map((v) => ({ id: v.id, value: v.value })),
    })),
    variants: product.variants.map((variant) => {
      const optionValues = variant.optionValueIds.map((id) => valueText.get(id) ?? '');
      // A name that is only its values is no name of the seller's: it keeps
      // following them when a value is renamed.
      const name = variant.name === optionValues.join(' / ') ? '' : (variant.name ?? '');
      return {
        id: variant.id,
        name,
        optionValues,
        sku: variant.sku,
        price: variant.price,
        stock: variant.stock,
        imageId: variant.imageId,
      };
    }),
  };
}

/**
 * A blank description is no description; a blank SKU asks the API for one; a
 * blank variant name leaves the variant called by its values.
 */
export function toDocument(values: CreateProduct): CreateProduct {
  return {
    ...values,
    description: values.description || null,
    variants: values.variants.map((variant) => ({
      ...variant,
      name: variant.name || undefined,
      sku: variant.sku || undefined,
    })),
  };
}
