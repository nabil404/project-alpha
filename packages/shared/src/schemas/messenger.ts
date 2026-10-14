import { z } from 'zod';
import { errorCodeSchema } from '../errors/codes';
import { productStatusSchema } from './catalog';

/**
 * A seller's connected Facebook Page as the API returns it. The Page access
 * token never leaves the server, so it has no field here.
 */
export const facebookPageSchema = z
  .object({
    id: z.string().uuid(),
    /** Facebook's own id for the Page. */
    pageId: z.string().min(1),
    name: z.string(),
    botEnabled: z.boolean(),
    connectedAt: z.string().datetime(),
  })
  .meta({ id: 'FacebookPage' });
export type FacebookPage = z.infer<typeof facebookPageSchema>;

/** GET /messenger/page: a shop has at most one Page, or none yet. */
export const facebookPageResponseSchema = z
  .object({
    page: facebookPageSchema.nullable(),
  })
  .meta({ id: 'FacebookPageResponse' });
export type FacebookPageResponse = z.infer<typeof facebookPageResponseSchema>;

/**
 * A Page the seller granted access to on Facebook, offered for connecting.
 * `canMessage` is false when their role on the Page doesn't include
 * messaging, which the assistant needs to answer chats.
 */
export const facebookPageCandidateSchema = z.object({
  pageId: z.string().min(1),
  name: z.string(),
  canMessage: z.boolean(),
});
export type FacebookPageCandidate = z.infer<typeof facebookPageCandidateSchema>;

export const facebookPageCandidatesResponseSchema = z
  .object({
    pages: z.array(facebookPageCandidateSchema),
  })
  .meta({ id: 'FacebookPageCandidatesResponse' });
export type FacebookPageCandidatesResponse = z.infer<typeof facebookPageCandidatesResponseSchema>;

/** POST /messenger/page/authorizations: where to send the browser next. */
export const facebookAuthorizationSchema = z
  .object({
    url: z.string().url(),
  })
  .meta({ id: 'FacebookAuthorization' });
export type FacebookAuthorization = z.infer<typeof facebookAuthorizationSchema>;

/** PUT /messenger/page: connect one of the candidates. Facebook Page ids are numeric strings. */
export const connectFacebookPageSchema = z
  .object({
    pageId: z
      .string()
      .trim()
      .regex(/^\d{1,32}$/),
  })
  .meta({ id: 'ConnectFacebookPage' });
export type ConnectFacebookPageInput = z.infer<typeof connectFacebookPageSchema>;

/**
 * Where the OAuth callback sends the browser back to, in the SPA. On success
 * it carries `step=choose-page`; on failure `error=<ErrorCode>`.
 */
export const MESSENGER_SETTINGS_PATH = '/settings/messenger';

export const messengerSettingsSearchSchema = z.object({
  step: z.literal('choose-page').optional().catch(undefined),
  error: errorCodeSchema.optional().catch(undefined),
});
export type MessengerSettingsSearch = z.infer<typeof messengerSettingsSearchSchema>;

/** A product link's `ref`: `p_` and the product id. Shared so the link and the webhook agree. */
export const PRODUCT_REF_PREFIX = 'p_';
const PRODUCT_REF = /^p_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** m.me accepts the numeric Page id, so no username lookup is needed. */
export function messengerProductLink(pageId: string, productId: string): string {
  return `https://m.me/${pageId}?ref=${PRODUCT_REF_PREFIX}${productId}`;
}

export function parseProductRef(ref: string): string | null {
  const match = PRODUCT_REF.exec(ref);
  return match ? (match[1] as string).toLowerCase() : null;
}

/** Meta's limits for the Messenger welcome screen. */
export const GREETING_MAX = 160;
export const ICE_BREAKERS_MAX = 4;
export const ICE_BREAKER_QUESTION_MAX = 80;

/** Code points, as Meta counts them; `.max()` would count UTF-16 units. */
const maxChars =
  (max: number, asSent: (value: string) => string = (value) => value) =>
  (value: string, ctx: z.RefinementCtx) => {
    if ([...asSent(value)].length > max) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'string',
        maximum: max,
        inclusive: true,
        input: value,
      });
    }
  };

/** Meta counts the greeting as sent: each `{first_name}` becomes `{{user_first_name}}`, 7 characters longer. */
const greetingAsSent = (greeting: string) =>
  greeting.replaceAll('{first_name}', '{{user_first_name}}');

export const iceBreakerSchema = z.object({
  /** `browse` opens the categories; `ask` is answered by the assistant like a typed question. */
  kind: z.enum(['browse', 'ask']),
  question: z.string().trim().min(1).superRefine(maxChars(ICE_BREAKER_QUESTION_MAX)),
});
export type IceBreaker = z.infer<typeof iceBreakerSchema>;

export const welcomeScreenInputSchema = z
  .object({
    greeting: z.string().trim().min(1).superRefine(maxChars(GREETING_MAX, greetingAsSent)),
    iceBreakers: z.array(iceBreakerSchema).max(ICE_BREAKERS_MAX),
  })
  .strict()
  .meta({ id: 'WelcomeScreenInput' });
export type WelcomeScreenInput = z.infer<typeof welcomeScreenInputSchema>;

export const profileSyncSchema = z.object({
  status: z.enum(['live', 'pending', 'failed', 'not_connected']),
  syncedAt: z.string().datetime().nullable(),
  error: z.enum(['token_invalid', 'graph_error']).nullable(),
});
export type ProfileSync = z.infer<typeof profileSyncSchema>;

export const welcomeScreenSchema = welcomeScreenInputSchema
  .extend({
    /** True while the seller has never saved: the values are the defaults for the shop's language. */
    isDefault: z.boolean(),
    profileSync: profileSyncSchema,
  })
  .meta({ id: 'WelcomeScreen' });
export type WelcomeScreen = z.infer<typeof welcomeScreenSchema>;

/** An ad seen in a referral, and the product it sells once the seller maps it. */
export const adProductSchema = z
  .object({
    id: z.string().uuid(),
    adId: z.string().min(1),
    firstSeenAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    chatCount: z.number().int().nonnegative(),
    product: z
      .object({ id: z.string().uuid(), name: z.string(), status: productStatusSchema })
      .nullable(),
  })
  .meta({ id: 'AdProduct' });
export type AdProduct = z.infer<typeof adProductSchema>;

export const adProductListResponseSchema = z
  .object({ data: z.array(adProductSchema) })
  .meta({ id: 'AdProductListResponse' });
export type AdProductListResponse = z.infer<typeof adProductListResponseSchema>;

export const updateAdProductSchema = z
  .object({ productId: z.string().uuid().nullable() })
  .strict()
  .meta({ id: 'UpdateAdProduct' });
export type UpdateAdProduct = z.infer<typeof updateAdProductSchema>;
