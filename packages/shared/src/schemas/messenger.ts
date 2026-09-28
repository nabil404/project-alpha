import { z } from 'zod';
import { errorCodeSchema } from '../errors/codes';

/**
 * A seller's connected Facebook Page as the API returns it. The Page access
 * token never leaves the server, so it has no field here.
 */
export const facebookPageSchema = z.object({
  id: z.string().uuid(),
  /** Facebook's own id for the Page. */
  pageId: z.string().min(1),
  name: z.string(),
  botEnabled: z.boolean(),
  connectedAt: z.string().datetime(),
});
export type FacebookPage = z.infer<typeof facebookPageSchema>;

/** GET /messenger/page: a shop has at most one Page, or none yet. */
export const facebookPageResponseSchema = z.object({
  page: facebookPageSchema.nullable(),
});
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

export const facebookPageCandidatesResponseSchema = z.object({
  pages: z.array(facebookPageCandidateSchema),
});
export type FacebookPageCandidatesResponse = z.infer<typeof facebookPageCandidatesResponseSchema>;

/** POST /messenger/page/authorizations: where to send the browser next. */
export const facebookAuthorizationSchema = z.object({
  url: z.string().url(),
});
export type FacebookAuthorization = z.infer<typeof facebookAuthorizationSchema>;

/** PUT /messenger/page: connect one of the candidates. Facebook Page ids are numeric strings. */
export const connectFacebookPageSchema = z.object({
  pageId: z
    .string()
    .trim()
    .regex(/^\d{1,32}$/),
});
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
