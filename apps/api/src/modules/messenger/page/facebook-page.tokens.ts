/**
 * Injection tokens shared by the Page service and the Messenger Profile sync.
 * Their own file, so the two classes can import each other's dependencies
 * without a circular import.
 */

/** Null when META_APP_ID is unset: connecting answers MESSENGER_NOT_CONFIGURED. */
export const META_GRAPH = Symbol('META_GRAPH');
/** Where Facebook sends the seller back to; must be listed in the Meta app's valid OAuth redirect URIs. */
export const PAGE_CONNECT_REDIRECT_URI = Symbol('PAGE_CONNECT_REDIRECT_URI');
