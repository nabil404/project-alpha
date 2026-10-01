// Shared k6 helpers for load tests that play Meta: signing and Page webhook
// payloads. Runs in the k6 runtime, not Node, so it imports k6 modules only.

import crypto from 'k6/crypto';

/**
 * `x-hub-signature-256` for a body, the contract verifyMetaSignature checks:
 * `sha256=` + hex HMAC of the exact bytes sent, keyed with the app secret.
 */
export function signBody(body, appSecret) {
  return `sha256=${crypto.hmac('sha256', appSecret, body, 'hex')}`;
}

/** A customer writing to the Page: one inbound job. */
export function customerMessage({ mid, pageId, psid, text }) {
  return {
    sender: { id: psid },
    recipient: { id: pageId },
    timestamp: Date.now(),
    message: { mid, text },
  };
}

/** The Page writing to a customer (seller reply or app send): one echo job. */
export function pageEcho({ mid, pageId, psid, text, appId }) {
  const message = { mid, text, is_echo: true };
  if (appId !== undefined) message.app_id = appId;
  return {
    sender: { id: pageId },
    recipient: { id: psid },
    timestamp: Date.now(),
    message,
  };
}

/** An attachment-only message: no text, so the webhook queues nothing for it. */
export function attachmentOnly({ mid, pageId, psid }) {
  return {
    sender: { id: psid },
    recipient: { id: pageId },
    timestamp: Date.now(),
    message: {
      mid,
      attachments: [{ type: 'image', payload: { url: 'https://example.invalid/x.jpg' } }],
    },
  };
}

/** A delivery receipt: no message at all, so no job either. */
export function delivery({ pageId, psid }) {
  return {
    sender: { id: psid },
    recipient: { id: pageId },
    timestamp: Date.now(),
    delivery: { mids: [], watermark: Date.now() },
  };
}

/** A Page webhook body: `entries` is a list of `{ pageId, messaging[] }`. */
export function pageWebhookBody(entries) {
  return {
    object: 'page',
    entry: entries.map(({ pageId, messaging }) => ({ id: pageId, time: Date.now(), messaging })),
  };
}
