import type { Mailer } from '../../mail/mail.service';
import type { MailMessage } from '../../mail/templates';

/** Captures mail instead of sending it, so a spec can follow the links. */
export class CapturingMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  dispatch(message: MailMessage): void {
    this.sent.push(message);
  }

  /** The most recent message to `to`, failing loudly if there is none. */
  lastTo(to: string): MailMessage {
    const message = this.sent.filter((mail) => mail.to === to).at(-1);
    if (!message) {
      throw new Error(`No mail sent to ${to}`);
    }
    return message;
  }

  /** The link in the most recent message to `to`, as a path on this server. */
  linkTo(to: string): string {
    const link = /https?:\/\/\S+/.exec(this.lastTo(to).text)?.[0];
    if (!link) {
      throw new Error(`No link in the last mail to ${to}`);
    }
    const parsed = new URL(link);
    return `${parsed.pathname}${parsed.search}`;
  }
}
