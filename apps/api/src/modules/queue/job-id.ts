/**
 * A custom BullMQ job id from an outside id such as a Messenger mid. BullMQ
 * refuses a colon in a custom id; escaping `%` first keeps the result one to
 * one with the input, so a redelivered event still dedupes on it.
 */
export function customJobId(prefix: string, id: string): string {
  return `${prefix}${id.replaceAll('%', '%25').replaceAll(':', '%3A')}`;
}
