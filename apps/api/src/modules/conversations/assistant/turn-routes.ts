import { customerIntentSchema, type CustomerIntent } from '@app/shared';
import type { ActiveState } from './conversation-machine';

/**
 * What code does with a classified message once the agents have read it.
 * A hand-off `before_merge` keeps nothing the message said; one `after_merge`
 * keeps the details extracted from it, so the seller sees them.
 */
export type RouteThen =
  | { kind: 'continue' }
  | {
      kind: 'handoff';
      reason: 'question' | 'complain' | 'request_human';
      when: 'before_merge' | 'after_merge';
    };

/** Which agents read a classified message, and what code does next. */
export interface Route {
  /** Whether OrderExtractionAgent reads the turn. */
  extract: boolean;
  then: RouteThen;
}

const go = (extract: boolean): Route => ({ extract, then: { kind: 'continue' } });

const handOff = (
  extract: boolean,
  reason: 'question' | 'complain' | 'request_human',
  when: 'before_merge' | 'after_merge',
): Route => ({ extract, then: { kind: 'handoff', reason, when } });

/**
 * Outside an order only an order needs extraction. In one, a bare answer
 * ("01812…", "Rahim") is often classified `other`, so every intent that does
 * not hand off at once is extracted. A question is extracted there too, so
 * the details it carries reach the seller with the hand-off.
 */
const ROUTES = {
  order: { outside: go(true), inOrder: go(true) },
  edit_order: { outside: go(true), inOrder: go(true) },
  browse: { outside: go(false), inOrder: go(true) },
  other: { outside: go(false), inOrder: go(true) },
  ask_question: {
    outside: handOff(false, 'question', 'after_merge'),
    inOrder: handOff(true, 'question', 'after_merge'),
  },
  complain: {
    outside: handOff(false, 'complain', 'before_merge'),
    inOrder: handOff(false, 'complain', 'before_merge'),
  },
  request_human: {
    outside: handOff(false, 'request_human', 'before_merge'),
    inOrder: handOff(false, 'request_human', 'before_merge'),
  },
} satisfies Record<CustomerIntent, { outside: Route; inOrder: Route }>;

const IN_ORDER = {
  browsing: false,
  abandoned: false,
  collecting_details: true,
  awaiting_confirmation: true,
} satisfies Record<ActiveState, boolean>;

/** The route for a message classified as `intent` in `state`. */
export function routeFor(state: ActiveState, intent: CustomerIntent): Route {
  const routes = ROUTES[intent];
  return IN_ORDER[state] ? routes.inOrder : routes.outside;
}

/**
 * Whether extraction's result is needed whatever the classifier says: every
 * intent either extracts or hands off before the merge, which ignores it.
 * Then extraction need not wait for the classifier.
 */
export function extractsWhateverIntent(state: ActiveState): boolean {
  return customerIntentSchema.options.every((intent) => {
    const route = routeFor(state, intent);
    return route.extract || (route.then.kind === 'handoff' && route.then.when === 'before_merge');
  });
}
