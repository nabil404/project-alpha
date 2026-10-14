import {
  ICE_BREAKERS_MAX,
  iceBreakerSchema,
  type IceBreaker,
  type WelcomeScreenInput,
} from '@app/shared';
import { z } from 'zod';
import type { ReplyLanguage } from '../../conversations/assistant/assistant-fallbacks';

/** The welcome screen a shop has until it saves its own. Draft Bangla, to be reviewed. */
const DEFAULTS: Record<ReplyLanguage, WelcomeScreenInput> = {
  bn: {
    greeting: 'আসসালামু আলাইকুম {first_name}! আমাদের পণ্য দেখতে Get Started চাপুন।',
    iceBreakers: [
      { kind: 'browse', question: 'পণ্য দেখান' },
      { kind: 'ask', question: 'ডেলিভারি চার্জ কত?' },
      { kind: 'ask', question: 'কীভাবে পেমেন্ট করব?' },
    ],
  },
  en: {
    greeting: 'Hi {first_name}! Tap Get Started to see what we have.',
    iceBreakers: [
      { kind: 'browse', question: 'See products' },
      { kind: 'ask', question: 'What is the delivery charge?' },
      { kind: 'ask', question: 'How do I pay?' },
    ],
  },
};

export function defaultWelcome(language: ReplyLanguage): WelcomeScreenInput {
  return DEFAULTS[language];
}

const storedIceBreakers = z.array(iceBreakerSchema).max(ICE_BREAKERS_MAX);

/** The stored list, or null when unset or unreadable (then the defaults apply). */
export function readIceBreakers(value: unknown): IceBreaker[] | null {
  const parsed = storedIceBreakers.safeParse(value);
  return parsed.success ? parsed.data : null;
}
