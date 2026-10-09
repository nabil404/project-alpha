/**
 * What the assistant's buttons and quick replies carry back in Messenger. A
 * Confirm or Change names the conversation and the summary revision it was
 * shown with; a pick names the candidate the customer tapped, so it resolves
 * by id and never by re-matching its shortened title.
 */
export type AssistantPayload =
  | { kind: 'confirm'; conversationId: string; revision: number }
  | { kind: 'change'; conversationId: string; revision: number }
  | { kind: 'pick'; slot: 'product' | 'variant'; id: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SUMMARY = new RegExp(`^(confirm|change):(${UUID}):(\\d{1,9})$`, 'i');
const PICK = new RegExp(`^pick:(product|variant):(${UUID})$`, 'i');

export function encodePayload(payload: AssistantPayload): string {
  return payload.kind === 'pick'
    ? `pick:${payload.slot}:${payload.id}`
    : `${payload.kind}:${payload.conversationId}:${payload.revision}`;
}

/** Null for anything this app did not encode: another app's button, or a tampered payload. */
export function parsePayload(text: string): AssistantPayload | null {
  const summary = SUMMARY.exec(text);
  if (summary) {
    return {
      kind: summary[1] as 'confirm' | 'change',
      conversationId: summary[2] as string,
      revision: Number(summary[3]),
    };
  }
  const pick = PICK.exec(text);
  if (pick) return { kind: 'pick', slot: pick[1] as 'product' | 'variant', id: pick[2] as string };
  return null;
}
