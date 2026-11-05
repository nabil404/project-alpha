import { customerIntentSchema, type CustomerIntent } from '@app/shared';
import type { ActiveState } from './conversation-machine';

/**
 * What code does with a classified message once the agents have read it.
 * A hand-off keeps nothing the message said, and wins over a failed or
 * low-confidence extraction.
 */
export type RouteThen =
  | { kind: 'continue' }
  /** Answer from the shop's facts (ShopAnswerAgent), or hand off as `question`. */
  | { kind: 'answer' }
  | { kind: 'handoff'; reason: 'complain' | 'request_human' };

/** Which agents read a classified message, and what code does next. */
export interface Route {
  /** Whether OrderExtractionAgent reads the turn. */
  extract: boolean;
  then: RouteThen;
}

const go = (extract: boolean): Route => ({ extract, then: { kind: 'continue' } });

const answer = (extract: boolean): Route => ({ extract, then: { kind: 'answer' } });

const handOff = (reason: 'complain' | 'request_human'): Route => ({
  extract: false,
  then: { kind: 'handoff', reason },
});

/**
 * Outside an order only an order needs extraction. In one, a bare answer
 * ("01812…", "Rahim") is often classified `other`, so every intent that does
 * not hand off at once is extracted. A question is extracted there too, so
 * the details it carries are kept while it is answered.
 */
const ROUTES = {
  order: { outside: go(true), inOrder: go(true) },
  edit_order: { outside: go(true), inOrder: go(true) },
  browse: { outside: go(false), inOrder: go(true) },
  other: { outside: go(false), inOrder: go(true) },
  ask_question: { outside: answer(false), inOrder: answer(true) },
  complain: { outside: handOff('complain'), inOrder: handOff('complain') },
  request_human: { outside: handOff('request_human'), inOrder: handOff('request_human') },
} satisfies Record<CustomerIntent, { outside: Route; inOrder: Route }>;

const IN_ORDER = {
  browsing: false,
  abandoned: false,
  collecting_details: true,
  awaiting_confirmation: true,
} satisfies Record<ActiveState, boolean>;

/** Collecting details or awaiting confirmation: an order is under way. */
export function isInOrder(state: ActiveState): boolean {
  return IN_ORDER[state];
}

/** The route for a message classified as `intent` in `state`. */
export function routeFor(state: ActiveState, intent: CustomerIntent): Route {
  const routes = ROUTES[intent];
  return isInOrder(state) ? routes.inOrder : routes.outside;
}

/**
 * Whether extraction's result is needed whatever the classifier says: every
 * intent either extracts or hands off, which ignores it.
 * Then extraction need not wait for the classifier.
 */
export function extractsWhateverIntent(state: ActiveState): boolean {
  return customerIntentSchema.options.every((intent) => {
    const route = routeFor(state, intent);
    return route.extract || route.then.kind === 'handoff';
  });
}
