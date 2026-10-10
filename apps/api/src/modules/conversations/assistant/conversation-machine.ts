import {
  collectedSlotsSchema,
  deliveryFeeFor,
  emptySlots,
  formatMinorUnits,
  hasCollectedAnything,
  MAX_QUICK_REPLIES,
  nextMissingSlot,
  parseCustomerPhone,
  type CollectedSlots,
  type ConversationState,
  type CustomerIntent,
  type ExtractedOrder,
  type IntentResult,
  type MissingSlot,
  type OrderItemSlot,
  type Product,
  type Quote,
  type Variant,
} from '@app/shared';
import type { ReplyLanguage } from './assistant-fallbacks';
import {
  matchArea,
  matchProduct,
  matchVariant,
  type CatalogView,
  type DeliveryArea,
} from './catalog-match';
import { mergeItems, mergeSameVariant } from './item-merge';
import type {
  AskReason,
  Choice,
  HandoffReason,
  LineFacts,
  ReplyFacts,
  ReplyIntent,
} from './reply-intent';

/** Below this, from either call, the assistant hands off instead of guessing. */
export const CONFIDENCE_FLOOR = 0.6;
/** The third ask for the same slot in a row hands off instead. */
export const MAX_ASKS = 3;

/** States a turn may run in; the ingest never queues one for the others. */
export type ActiveState = Exclude<ConversationState, 'handed_off' | 'confirmed'>;

export function isActiveState(state: ConversationState): state is ActiveState {
  return state !== 'handed_off' && state !== 'confirmed';
}

/** The shop's delivery settings as the quote needs them. */
export interface DeliveryView {
  areas: DeliveryArea[];
  /** Everywhere else; null until the shop first saves its delivery settings. */
  fallback: DeliveryArea | null;
  freeDeliveryOver: number | null;
  currency: string;
}

/** A tapped quick reply that names one of the candidates offered for an item. */
export interface ItemPick {
  slot: 'product' | 'variant';
  item: number;
  id: string;
}

/** What started the turn: a message the LLM read, or a tap that needs no reading. */
export type TurnTrigger =
  | {
      kind: 'message';
      classified: IntentResult | 'failed';
      extracted: ExtractedOrder | 'failed' | 'skipped';
    }
  | { kind: 'pick'; pick: ItemPick };

export interface TurnInput {
  state: ActiveState;
  slots: CollectedSlots;
  trigger: TurnTrigger;
  /** The shop's country: the region a local phone number is read in. */
  country: string;
  /** Formats the money in the facts. */
  language: ReplyLanguage;
  catalog: CatalogView;
  delivery: DeliveryView;
}

export interface TurnDecision {
  state: ConversationState;
  slots: CollectedSlots;
  reply: ReplyIntent;
  /** A product photo to send before the reply: the item matched most recently this turn. */
  image?: string;
}

/**
 * Mid-flow, a bare answer ("01812…", "Rahim") is often classified `other`, so
 * extraction runs on every turn there; while browsing only an order needs it.
 */
export function shouldExtract(state: ActiveState, intent: CustomerIntent): boolean {
  if (intent === 'complain' || intent === 'request_human') return false;
  if (state === 'collecting_details' || state === 'awaiting_confirmation') return true;
  return intent === 'order' || intent === 'edit_order';
}

/** The tap as a pick when it names a candidate the last reply offered; otherwise null. */
export function validPick(
  slots: CollectedSlots,
  tap: { slot: 'product' | 'variant'; id: string },
): ItemPick | null {
  const offered = slots.offered;
  if (!offered || offered.slot !== tap.slot || !offered.ids.includes(tap.id)) return null;
  return { slot: tap.slot, item: offered.item, id: tap.id };
}

export const LOCALES: Record<ReplyLanguage, string> = { bn: 'bn-BD', en: 'en-US' };

/** Slots written by an older shape, or by hand, read as nothing collected rather than failing the turn. */
export function readSlots(value: unknown): CollectedSlots {
  const parsed = collectedSlotsSchema.safeParse(value);
  return parsed.success ? parsed.data : emptySlots();
}

/**
 * One turn, decided by code: hand-off rules, then the tap or the extraction
 * merged in, each item matched to the catalog, the delivery row matched to
 * the address, then the next thing to ask, or the summary when nothing is
 * missing.
 */
export function decideTurn(input: TurnInput): TurnDecision {
  const { trigger, catalog } = input;
  let slots = input.slots;
  let intent: CustomerIntent = 'order';
  let invalidPhone = false;
  const picked: number[] = [];

  if (trigger.kind === 'message') {
    const { classified, extracted } = trigger;
    if (classified === 'failed' || extracted === 'failed') return handOff(slots, 'llm_failed');
    if (classified.intent === 'complain' || classified.intent === 'request_human') {
      return handOff(slots, classified.intent);
    }
    if (
      classified.confidence < CONFIDENCE_FLOOR ||
      (extracted !== 'skipped' &&
        !isEmptyExtraction(extracted) &&
        extracted.confidence < CONFIDENCE_FLOOR)
    ) {
      return handOff(slots, 'low_confidence');
    }
    if (extracted !== 'skipped') {
      const merged = mergeExtraction(slots, extracted, input.country, catalog);
      slots = merged.slots;
      invalidPhone = merged.invalidPhone;
    }
    if (classified.intent === 'ask_question') return handOff(slots, 'question');
    intent = classified.intent;
  } else {
    slots = applyPick(slots, trigger.pick);
    picked.push(trigger.pick.item);
  }

  const resolved = resolveItems(slots.items, catalog, picked);
  slots = resolveDelivery(
    { ...slots, items: resolved.items, offered: remapOffered(slots.offered, resolved.moved) },
    input.delivery,
  );
  const image = imageFor(resolved.items, resolved.touched, catalog);

  // A phone just refused is asked for again at once, whatever would come next (phase 1, D5).
  const missing: MissingSlot | null =
    invalidPhone && slots.phone === undefined
      ? { slot: 'phone' }
      : nextMissingSlot(slots, (productId) => {
          const found = findProduct(catalog, productId);
          return found !== undefined && found.variants.length > 1;
        });

  if (missing === null) {
    if (slots.deliveryChargeId === undefined) return handOff(slots, 'no_delivery_charge');
    if (input.state === 'awaiting_confirmation' && sameOrder(input.slots, slots)) {
      return handOff(slots, 'awaiting_seller');
    }
    const quote = quoteFor(slots, catalog, input.delivery, input.slots.revision + 1);
    const next: CollectedSlots = {
      ...slots,
      revision: quote.revision,
      quote,
      offered: undefined,
      lastAsked: undefined,
    };
    return {
      state: 'awaiting_confirmation',
      slots: next,
      reply: { kind: 'summary', quote, facts: factsOf(next, input, { quote }) },
      ...withImage(image),
    };
  }

  const item = 'item' in missing ? missing.item : undefined;
  const last = slots.lastAsked;
  const times = last?.slot === missing.slot && last.item === item ? last.times + 1 : 1;
  if (times >= MAX_ASKS) return handOff(slots, 'repeated_confusion');

  const problem = resolved.problems.find(
    (entry) => entry.slot === missing.slot && entry.item === item,
  );
  let choices = problem?.choices;
  if (missing.slot === 'variant' && item !== undefined && choices === undefined) {
    const owner = findProduct(catalog, slots.items[item]?.productId);
    if (owner) choices = inStockChoices(owner, owner.variants);
  }
  const offered =
    choices && choices.length > 0 && item !== undefined && missing.slot !== 'quantity'
      ? {
          slot: missing.slot as 'product' | 'variant',
          item,
          ids: choices.map((choice) => choice.id),
        }
      : undefined;
  const reason: AskReason | undefined =
    problem?.reason ?? (invalidPhone && missing.slot === 'phone' ? 'invalid_phone' : undefined);
  const asked: CollectedSlots = {
    ...slots,
    offered,
    lastAsked: { slot: missing.slot, item, times },
  };

  return {
    state: hasCollectedAnything(slots) ? 'collecting_details' : 'browsing',
    slots: asked,
    reply: {
      kind: 'ask_slot',
      slot: missing.slot,
      ...(item === undefined ? {} : { item }),
      intent,
      ...(reason === undefined ? {} : { reason }),
      ...(offered ? { choices } : {}),
      facts: factsOf(asked, input, { problem }),
    },
    ...withImage(image),
  };
}

/** Why one item's slot is asked again, found while matching it against the catalog. */
interface Problem {
  slot: 'product' | 'variant' | 'quantity';
  item: number;
  reason: AskReason;
  choices?: Choice[];
  /** The product or variant found out of stock. */
  unavailable?: string;
  /** Units in stock, when the customer asked for more. */
  available?: number;
}

function findProduct(catalog: CatalogView, id: string | undefined): Product | undefined {
  return id === undefined ? undefined : catalog.products.find((product) => product.id === id);
}

function inStockChoices(product: Product, variants: readonly Variant[]): Choice[] {
  return variants
    .filter((variant) => variant.stock > 0)
    .slice(0, MAX_QUICK_REPLIES)
    .map((variant) => ({ id: variant.id, title: variant.name ?? product.name }));
}

/**
 * One item's words matched to the catalog. A clear match fills its ids; a
 * close call, nothing found, or no stock is a problem the ask explains. Ids
 * the catalog no longer sells are dropped and matched again.
 */
function resolveItem(
  original: OrderItemSlot,
  index: number,
  catalog: CatalogView,
  problems: Problem[],
  touched: Set<number>,
): OrderItemSlot {
  const item: OrderItemSlot = { ...original };
  let product = findProduct(catalog, item.productId);
  if (product === undefined) {
    delete item.productId;
    delete item.variantId;
    if (item.productQuery === undefined) return item;
    const match = matchProduct([item.productQuery, item.productQueryAlt], catalog);
    if (match.kind === 'none') {
      problems.push({ slot: 'product', item: index, reason: 'not_found' });
      return item;
    }
    if (match.kind === 'some') {
      problems.push({
        slot: 'product',
        item: index,
        reason: 'choose',
        choices: match.productIds.map((id) => ({ id, title: findProduct(catalog, id)!.name })),
      });
      return item;
    }
    product = findProduct(catalog, match.productId)!;
    item.productId = product.id;
    touched.add(index);
  }

  if (!product.variants.some((variant) => variant.stock > 0)) {
    delete item.productId;
    delete item.variantId;
    problems.push({
      slot: 'product',
      item: index,
      reason: 'product_out_of_stock',
      unavailable: product.name,
    });
    return item;
  }
  if (product.variants.length === 1) {
    item.variantId = product.variants[0]!.id;
    return item;
  }
  let variant = product.variants.find((entry) => entry.id === item.variantId);
  if (variant === undefined) {
    delete item.variantId;
    if (item.variantQuery === undefined) return item;
    const match = matchVariant([item.variantQuery, item.variantQueryAlt], product);
    if (match.kind === 'none') {
      problems.push({
        slot: 'variant',
        item: index,
        reason: 'not_found',
        choices: inStockChoices(product, product.variants),
      });
      return item;
    }
    if (match.kind === 'some') {
      const close = inStockChoices(
        product,
        product.variants.filter((entry) => match.variantIds.includes(entry.id)),
      );
      problems.push(
        close.length > 0
          ? { slot: 'variant', item: index, reason: 'choose', choices: close }
          : {
              slot: 'variant',
              item: index,
              reason: 'out_of_stock',
              choices: inStockChoices(product, product.variants),
            },
      );
      return item;
    }
    variant = product.variants.find((entry) => entry.id === match.variantId)!;
    touched.add(index);
  }
  if (variant.stock <= 0) {
    delete item.variantId;
    problems.push({
      slot: 'variant',
      item: index,
      reason: 'out_of_stock',
      unavailable: variant.name ?? product.name,
      choices: inStockChoices(product, product.variants),
    });
    return item;
  }
  item.variantId = variant.id;
  return item;
}

/**
 * Every item resolved, items on the same variant merged, then each variant's
 * quantity checked against its stock. `moved` maps each item's index before
 * the merge to its index after.
 */
function resolveItems(
  items: readonly OrderItemSlot[],
  catalog: CatalogView,
  picked: readonly number[],
): { items: OrderItemSlot[]; problems: Problem[]; touched: number[]; moved: number[] } {
  const problems: Problem[] = [];
  const touched = new Set(picked);
  const resolved = items.map((item, index) => resolveItem(item, index, catalog, problems, touched));
  const { items: merged, moved } = mergeSameVariant(resolved);
  const remapped = problems.map((problem) => ({ ...problem, item: moved[problem.item]! }));
  for (const [index, item] of merged.entries()) {
    const variant = findProduct(catalog, item.productId)?.variants.find(
      (entry) => entry.id === item.variantId,
    );
    if (variant && item.quantity !== undefined && item.quantity > variant.stock) {
      delete item.quantity;
      remapped.push({
        slot: 'quantity',
        item: index,
        reason: 'too_many',
        available: variant.stock,
      });
    }
  }
  return {
    items: merged,
    problems: remapped,
    touched: [...touched].map((index) => moved[index]!),
    moved,
  };
}

function remapOffered(
  offered: CollectedSlots['offered'],
  moved: number[],
): CollectedSlots['offered'] {
  if (!offered) return undefined;
  const item = moved[offered.item];
  return item === undefined ? undefined : { ...offered, item };
}

function applyPick(slots: CollectedSlots, pick: ItemPick): CollectedSlots {
  const items = slots.items.map((item, index) => {
    if (index !== pick.item) return item;
    if (pick.slot === 'variant') return { ...item, variantId: pick.id };
    const { variantId: _variantId, ...rest } = item;
    return { ...rest, productId: pick.id };
  });
  return { ...slots, items, offered: undefined };
}

/** A missing or stale delivery row is matched again from the area and the address. */
function resolveDelivery(slots: CollectedSlots, delivery: DeliveryView): CollectedSlots {
  const rows = delivery.fallback ? [...delivery.areas, delivery.fallback] : delivery.areas;
  if (rows.some((row) => row.id === slots.deliveryChargeId)) return slots;
  if (slots.deliveryAddress === undefined) return { ...slots, deliveryChargeId: undefined };
  const area = matchArea(
    slots.deliveryArea,
    slots.deliveryAddress,
    delivery.areas,
    delivery.fallback,
  );
  return { ...slots, deliveryChargeId: area?.id };
}

/** The variant's own photo, else the product's cover, for the last item matched this turn. */
function imageFor(
  items: readonly OrderItemSlot[],
  touched: readonly number[],
  catalog: CatalogView,
): string | undefined {
  if (touched.length === 0) return undefined;
  const item = items[Math.max(...touched)];
  const product = findProduct(catalog, item?.productId);
  if (!item || !product) return undefined;
  const variant = product.variants.find((entry) => entry.id === item.variantId);
  const imageId = variant?.imageId ?? product.coverImageId;
  return product.images.find((image) => image.id === imageId)?.url;
}

function withImage(image: string | undefined): { image?: string } {
  return image === undefined ? {} : { image };
}

/** Whether a turn changed nothing the summary card shows. */
function sameOrder(before: CollectedSlots, after: CollectedSlots): boolean {
  const shown = (slots: CollectedSlots) =>
    JSON.stringify([
      slots.items.map((item) => [item.variantId, item.quantity]),
      slots.customerName,
      slots.phone,
      slots.deliveryAddress,
      slots.deliveryChargeId,
    ]);
  return shown(before) === shown(after);
}

/**
 * The numbers the card shows, from the catalog and the shop's delivery
 * settings: each line's price times its quantity, and one fee over every
 * line's product, as POST /orders/delivery-quote computes it.
 */
export function quoteFor(
  slots: CollectedSlots,
  catalog: CatalogView,
  delivery: DeliveryView,
  revision: number,
): Quote {
  const lines = slots.items.map((item) => {
    const product = findProduct(catalog, item.productId)!;
    const variant = product.variants.find((entry) => entry.id === item.variantId)!;
    const quantity = item.quantity!;
    return {
      productId: product.id,
      variantId: variant.id,
      quantity,
      unitPrice: variant.price,
      lineTotal: variant.price * quantity,
    };
  });
  const rows = delivery.fallback ? [...delivery.areas, delivery.fallback] : delivery.areas;
  const area = rows.find((row) => row.id === slots.deliveryChargeId)!;
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const deliveryFee = deliveryFeeFor({
    shopCharge: area.charge,
    productCharges: productIds.map(
      (id) =>
        findProduct(catalog, id)!.deliveryCharges.find((row) => row.deliveryChargeId === area.id)
          ?.charge ?? null,
    ),
    subtotal,
    freeDeliveryOver: delivery.freeDeliveryOver,
  });
  return {
    revision,
    lines,
    subtotal,
    deliveryChargeId: area.id,
    deliveryFee,
    total: subtotal + deliveryFee,
    currency: delivery.currency,
  };
}

/**
 * What a phrased reply may say: catalog names and formatted prices for each
 * item, the customer's details, and for a summary the delivery and totals.
 */
export function factsOf(
  slots: CollectedSlots,
  { catalog, delivery, language }: Pick<TurnInput, 'catalog' | 'delivery' | 'language'>,
  extra: { quote?: Quote; problem?: Problem } = {},
): ReplyFacts {
  const money = (amount: number) => formatMinorUnits(amount, delivery.currency, LOCALES[language]);
  const items = slots.items.map((item, index): LineFacts => {
    const product = findProduct(catalog, item.productId);
    const variant = product?.variants.find((entry) => entry.id === item.variantId);
    const line: LineFacts = { productName: product?.name ?? item.productQuery ?? '' };
    if (variant?.name) line.variantName = variant.name;
    if (item.quantity !== undefined) line.quantity = item.quantity;
    if (variant) {
      line.unitPrice = money(variant.price);
      line.inStock = variant.stock > 0;
      if (item.quantity !== undefined) line.lineTotal = money(variant.price * item.quantity);
    }
    if (extra.problem?.item === index && extra.problem.available !== undefined) {
      line.available = extra.problem.available;
    }
    return line;
  });
  const facts: ReplyFacts = { items };
  if (slots.customerName !== undefined) facts.customerName = slots.customerName;
  if (slots.phone !== undefined) facts.phone = slots.phone;
  if (slots.deliveryAddress !== undefined) facts.deliveryAddress = slots.deliveryAddress;
  if (extra.problem?.unavailable !== undefined) facts.unavailable = extra.problem.unavailable;
  const quote = extra.quote;
  if (quote) {
    const area = delivery.areas.find((row) => row.id === quote.deliveryChargeId);
    if (area?.areaName) facts.areaName = area.areaName;
    facts.subtotal = money(quote.subtotal);
    facts.deliveryFee = money(quote.deliveryFee);
    facts.total = money(quote.total);
  }
  return facts;
}

/** An extraction that filled nothing says nothing about how sure it is. */
function isEmptyExtraction(extraction: ExtractedOrder): boolean {
  const { confidence: _confidence, ...fields } = extraction;
  return Object.values(fields).every((value) => value === null);
}

/**
 * Extraction merged into the slots. The item list goes through mergeItems; a
 * detail replaces its slot when given, and null never does. A phone is kept
 * only if it is a real number. A new address or area clears the matched
 * delivery row. Candidates offered for an item stay only while that item is
 * unchanged.
 */
export function mergeExtraction(
  slots: CollectedSlots,
  extraction: ExtractedOrder,
  country: string,
  catalog: CatalogView,
): { slots: CollectedSlots; invalidPhone: boolean } {
  const next: CollectedSlots = { ...slots };
  if (extraction.items !== null) {
    const { items, origins } = mergeItems(
      slots.items,
      extraction.items,
      (id) => findProduct(catalog, id)?.name,
    );
    next.items = items;
    const offered = slots.offered;
    const at = offered ? origins.indexOf(offered.item) : -1;
    next.offered =
      offered && at >= 0 && items[at]!.variantQuery === slots.items[offered.item]?.variantQuery
        ? { ...offered, item: at }
        : undefined;
  }
  const name = words(extraction.customerName);
  if (name !== undefined) next.customerName = name;
  const address = words(extraction.deliveryAddress);
  if (address !== undefined && address !== slots.deliveryAddress) {
    next.deliveryAddress = address;
    next.deliveryChargeId = undefined;
  }
  const area = words(extraction.deliveryArea);
  if (area !== undefined && area !== slots.deliveryArea) {
    next.deliveryArea = area;
    next.deliveryChargeId = undefined;
  }

  let invalidPhone = false;
  const phoneText = words(extraction.phone);
  if (phoneText !== undefined) {
    const phone = parseCustomerPhone(phoneText, country);
    if (phone === null) invalidPhone = true;
    else next.phone = phone;
  }
  return { slots: next, invalidPhone };
}

function words(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function handOff(slots: CollectedSlots, reason: HandoffReason): TurnDecision {
  return {
    state: 'handed_off',
    slots: { ...slots, lastAsked: undefined, offered: undefined },
    reply: { kind: 'handoff', reason },
  };
}
