import { languagesOf } from '@app/shared';

/**
 * What a shop's region changes in the prompts. Everything else in a prompt is
 * shared, so a region is these three values and nothing more.
 */
export interface PromptPack {
  /** BCP-47; stored on each llm_call row to tell which prompt ran. */
  id: string;
  /** ISO 639-1: the reply language when the customer's own is unclear. */
  replyLanguage: string;
  /** What customers write in, as one phrase the prompts quote. */
  chatLanguages: string;
}

const BN_BD: PromptPack = {
  id: 'bn-BD',
  replyLanguage: 'bn',
  chatLanguages: 'Bangla, Banglish (Bangla in Latin letters) or English',
};

/** Hand-written packs by country; every other country gets a generic one. */
const PACKS: Partial<Record<string, PromptPack>> = { BD: BN_BD };

/** English names, since the prompts are English: `hi` is Hindi. */
const LANGUAGE_NAMES = new Intl.DisplayNames('en', { type: 'language' });

/** The country's own languages and English, as the country lists them. */
function genericPack(country: string): PromptPack {
  const languages = [...new Set([...languagesOf(country), 'en'])];
  const names = languages.map((code) => LANGUAGE_NAMES.of(code) ?? code);
  return {
    id: `${languages[0]}-${country}`,
    replyLanguage: languages[0]!,
    chatLanguages:
      names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`,
  };
}

export function promptPackFor(country: string): PromptPack {
  return PACKS[country] ?? genericPack(country);
}
