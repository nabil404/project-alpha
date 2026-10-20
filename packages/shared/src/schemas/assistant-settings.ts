import { z } from 'zod';

/**
 * Settings > Order assistant: how the assistant talks to the shop's
 * customers. One set per shop; a shop that has never saved reads as
 * ASSISTANT_SETTINGS_DEFAULTS.
 */

export const ASSISTANT_TONES = ['friendly', 'direct', 'formal'] as const;
export const assistantToneSchema = z.enum(ASSISTANT_TONES);
export type AssistantTone = z.infer<typeof assistantToneSchema>;

/** An ISO 639-1 code. Which ones the assistant supports comes from the API's env. */
export const languageCodeSchema = z.string().regex(/^[a-z]{2}$/);

/** `match` follows the customer, falling back to the shop's country default. */
export const MATCH_CUSTOMER = 'match';
export const assistantLanguageSchema = z.union([z.literal(MATCH_CUSTOMER), languageCodeSchema]);
export type AssistantLanguage = z.infer<typeof assistantLanguageSchema>;

export const ASSISTANT_NOTES_MAX = 1000;

/** The fields a seller saves. */
export const assistantSettingsSchema = z
  .object({
    tone: assistantToneSchema,
    /** The language to reply in when the customer's own is unclear. */
    defaultLanguage: assistantLanguageSchema,
    /** Short facts from the seller, such as delivery days. Prices and stock come from the catalog. */
    notes: z.string().trim().max(ASSISTANT_NOTES_MAX),
  })
  .meta({ id: 'AssistantSettings' });
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

export const ASSISTANT_SETTINGS_DEFAULTS: AssistantSettings = {
  tone: 'friendly',
  defaultLanguage: MATCH_CUSTOMER,
  notes: '',
};

/** GET and PATCH /settings/assistant: the settings, and the languages `defaultLanguage` may name. */
export const assistantSettingsViewSchema = assistantSettingsSchema
  .extend({ supportedLanguages: z.array(languageCodeSchema) })
  .meta({ id: 'AssistantSettingsView' });
export type AssistantSettingsView = z.infer<typeof assistantSettingsViewSchema>;

/** PATCH /settings/assistant. Omit a field to leave it alone. */
export const updateAssistantSettingsSchema = assistantSettingsSchema
  .partial()
  .strict()
  .meta({ id: 'UpdateAssistantSettings' });
export type UpdateAssistantSettings = z.infer<typeof updateAssistantSettingsSchema>;
