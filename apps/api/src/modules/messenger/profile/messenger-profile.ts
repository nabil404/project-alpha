import type { IceBreaker } from '@app/shared';
import type { ReplyLanguage } from '../../conversations/assistant/assistant-fallbacks';

/** Every field we own on the Page's profile; DELETE clears the same list. */
export const PROFILE_FIELDS = [
  'get_started',
  'greeting',
  'ice_breakers',
  'persistent_menu',
] as const;

const MENU: Record<ReplyLanguage, { browse: string; lastOrder: string; human: string }> = {
  bn: { browse: 'পণ্য দেখুন', lastOrder: 'আমার শেষ অর্ডার', human: 'একজন মানুষের সাথে কথা বলুন' },
  en: { browse: 'Browse products', lastOrder: 'My last order', human: 'Talk to a person' },
};

export interface MessengerProfileBody {
  get_started: { payload: string };
  greeting: { locale: string; text: string }[];
  ice_breakers: { locale: string; call_to_actions: { question: string; payload: string }[] }[];
  persistent_menu: {
    locale: string;
    composer_input_disabled: boolean;
    call_to_actions: { type: 'postback'; title: string; payload: string }[];
  }[];
}

/**
 * The whole Messenger Profile, built in code. Meta replaces each field it is
 * sent, so sending all of them every time is idempotent. Seller text says
 * `{first_name}`; Meta's placeholder is `{{user_first_name}}`. Ice breakers use
 * the localized shape (a list per locale); an empty list is meant to clear
 * them. Both still need a live check against the dev Page: if Graph refuses
 * an empty `ice_breakers`, clear it with a DELETE instead.
 */
export function buildMessengerProfile({
  greeting,
  iceBreakers,
  language,
}: {
  greeting: string;
  iceBreakers: IceBreaker[];
  language: ReplyLanguage;
}): MessengerProfileBody {
  const menu = MENU[language];
  return {
    get_started: { payload: 'start' },
    greeting: [
      { locale: 'default', text: greeting.replaceAll('{first_name}', '{{user_first_name}}') },
    ],
    ice_breakers:
      iceBreakers.length === 0
        ? []
        : [
            {
              locale: 'default',
              call_to_actions: iceBreakers.map((breaker) => ({
                question: breaker.question,
                payload: breaker.kind,
              })),
            },
          ],
    persistent_menu: [
      {
        locale: 'default',
        composer_input_disabled: false,
        call_to_actions: [
          { type: 'postback', title: menu.browse, payload: 'browse' },
          { type: 'postback', title: menu.lastOrder, payload: 'menu:last-order' },
          { type: 'postback', title: menu.human, payload: 'menu:human' },
        ],
      },
    ],
  };
}
