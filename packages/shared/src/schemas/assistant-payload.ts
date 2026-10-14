/**
 * What the assistant's buttons and quick replies carry back in Messenger. A
 * Confirm or Change names the conversation and the summary revision it was
 * shown with; a pick names the candidate the customer tapped, so it resolves
 * by id and never by re-matching its shortened title. Entry payloads come from
 * Get Started, the menu, ice breakers, browsing and referrals.
 */
export type AssistantPayload =
  | { kind: 'confirm'; conversationId: string; revision: number }
  | { kind: 'change'; conversationId: string; revision: number }
  | { kind: 'pick'; slot: 'product' | 'variant'; id: string }
  | { kind: 'start' }
  /** null: the category list; 'other': products with no category. */
  | { kind: 'browse'; categoryId: string | 'other' | null }
  /**
   * `choose` is a carousel tap; `ref` a product link or a mapped ad opened on
   * its own or with Get Started; `ref-typed` one that came with a message the
   * customer typed. The ingest stores both refs.
   */
  | { kind: 'product'; via: ProductVia; id: string }
  | { kind: 'menu'; item: 'last-order' | 'human' };

export type ProductVia = 'choose' | 'ref' | 'ref-typed';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SUMMARY = new RegExp(`^(confirm|change):(${UUID}):(\\d{1,9})$`, 'i');
const PICK = new RegExp(`^pick:(product|variant):(${UUID})$`, 'i');
const CATEGORY = new RegExp(`^browse:cat:(${UUID}|other)$`, 'i');
const PRODUCT = new RegExp(`^(choose|ref|ref-typed):product:(${UUID})$`, 'i');
const MENU = /^menu:(last-order|human)$/;

export function encodePayload(payload: AssistantPayload): string {
  switch (payload.kind) {
    case 'confirm':
    case 'change':
      return `${payload.kind}:${payload.conversationId}:${payload.revision}`;
    case 'pick':
      return `pick:${payload.slot}:${payload.id}`;
    case 'start':
      return 'start';
    case 'browse':
      return payload.categoryId === null ? 'browse' : `browse:cat:${payload.categoryId}`;
    case 'product':
      return `${payload.via}:product:${payload.id}`;
    case 'menu':
      return `menu:${payload.item}`;
  }
}

/** Null for anything this app did not encode: another app's button, a tampered payload, or `ask`. */
export function parsePayload(text: string): AssistantPayload | null {
  const summary = SUMMARY.exec(text);
  if (summary) {
    return {
      kind: summary[1] as 'confirm' | 'change',
      conversationId: summary[2] as string,
      revision: Number(summary[3]),
    };
  }
  const pick = PICK.exec(text);
  if (pick) return { kind: 'pick', slot: pick[1] as 'product' | 'variant', id: pick[2] as string };
  if (text === 'start') return { kind: 'start' };
  if (text === 'browse') return { kind: 'browse', categoryId: null };
  const category = CATEGORY.exec(text);
  if (category) return { kind: 'browse', categoryId: (category[1] as string).toLowerCase() };
  const product = PRODUCT.exec(text);
  if (product) {
    return { kind: 'product', via: product[1] as ProductVia, id: product[2] as string };
  }
  const menu = MENU.exec(text);
  if (menu) return { kind: 'menu', item: menu[1] as 'last-order' | 'human' };
  return null;
}
