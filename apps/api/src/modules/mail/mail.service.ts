import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../../config/app.config.js';
import type { MailMessage } from './templates.js';

/** What Better Auth's email callbacks depend on, so a spec can capture mail instead. */
export interface Mailer {
  /**
   * Hands the message to SMTP and returns at once. A failure is logged, never
   * thrown: auth endpoints must answer in the same time whether or not a
   * message went out, or the delay would tell an attacker which emails have
   * accounts.
   */
  dispatch(message: MailMessage): void;
}

/**
 * SMTP through Nodemailer. SMTP_URL points at Mailpit locally and at a
 * transactional provider in production, so switching provider is a config
 * change, not a code change.
 */
@Injectable()
export class MailService implements Mailer {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: AppConfig) {
    this.transport = createTransport(config.get('SMTP_URL'));
    this.from = config.get('MAIL_FROM');
  }

  dispatch(message: MailMessage): void {
    this.transport.sendMail({ from: this.from, ...message }).catch((error: unknown) => {
      // The body carries a single-use token, so only the subject and the
      // recipient's domain are safe to log.
      const domain = message.to.split('@').at(-1);
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send "${message.subject}" to @${domain}: ${reason}`);
    });
  }
}
