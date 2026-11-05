import { customerIntentSchema, type CustomerIntent } from '@app/shared';
import type { ActiveState } from '../conversation-machine';
import { extractsWhateverIntent, routeFor, type Route } from '../turn-routes';

const intents = customerIntentSchema.options;
const activeStates: ActiveState[] = [
  'browsing',
  'collecting_details',
  'awaiting_confirmation',
  'abandoned',
];
const inOrder = (state: ActiveState) =>
  state === 'collecting_details' || state === 'awaiting_confirmation';

const go = (extract: boolean): Route => ({ extract, then: { kind: 'continue' } });
const before = (reason: 'complain' | 'request_human'): Route => ({
  extract: false,
  then: { kind: 'handoff', reason },
});
const question = (extract: boolean): Route => ({ extract, then: { kind: 'answer' } });

/** Every cell, written out, so the table cannot drift without this spec changing. */
const EXPECTED: Record<CustomerIntent, { outside: Route; inOrder: Route }> = {
  order: { outside: go(true), inOrder: go(true) },
  edit_order: { outside: go(true), inOrder: go(true) },
  browse: { outside: go(false), inOrder: go(true) },
  other: { outside: go(false), inOrder: go(true) },
  ask_question: { outside: question(false), inOrder: question(true) },
  complain: { outside: before('complain'), inOrder: before('complain') },
  request_human: { outside: before('request_human'), inOrder: before('request_human') },
};

const cells = activeStates.flatMap((state) => intents.map((intent) => [state, intent] as const));

describe('routeFor', () => {
  it.each(cells)('%s × %s', (state, intent) => {
    const expected = EXPECTED[intent];
    expect(routeFor(state, intent)).toEqual(inOrder(state) ? expected.inOrder : expected.outside);
  });

  // The gate the turn service used before the table, kept to prove the table matches it.
  it.each(cells)('extracts %s × %s as the old gate did', (state, intent) => {
    const old =
      intent === 'complain' || intent === 'request_human'
        ? false
        : inOrder(state)
          ? true
          : intent === 'order' || intent === 'edit_order';
    expect(routeFor(state, intent).extract).toBe(old);
  });
});

describe('extractsWhateverIntent', () => {
  it.each(activeStates)('%s', (state) => {
    expect(extractsWhateverIntent(state)).toBe(inOrder(state));
  });
});
