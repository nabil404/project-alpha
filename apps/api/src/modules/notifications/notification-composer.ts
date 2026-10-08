import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_COUNTRY, formatMinorUnits, formatShopDate, regionDefaults } from '@app/shared';
import { AppConfig } from '../config/app.config';
import type { TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import type { MailContent, MailMessage } from '../mail/templates';
import { listMerchantIds } from '../conversations/profiles/merchant-ids';
import { CUSTOMER_WAITING_DELAY_MS } from '../queue/queue.constants';
import {
  NotificationPreferencesRepository,
  type NotificationRecipient,
} from '../settings/notification-preferences.repository';
import { ShopProfileRepository } from '../settings/shop-profile.repository';
import { customerWaitingEmail, dailySummaryEmail, orderDraftedEmail } from './notification-emails';
import { NotificationReadsRepository, type ShopRegion } from './notification-reads.repository';
import { dailySummaryDayDue } from './shop-clock';

/** One email for one person; `userId` makes its send job's id. */
export interface NotificationEmail {
  userId: string;
  message: MailMessage;
}

/** Money and dates in emails are in English until emails follow the reader's language. */
const EMAIL_LOCALE = 'en-US';

function addressed(recipients: NotificationRecipient[], content: MailContent): NotificationEmail[] {
  return recipients.map(({ userId, email }) => ({ userId, message: { to: email, ...content } }));
}

/**
 * Decides whether an event still warrants an email and writes it, one per
 * member who wants it. Everything is read in one short transaction under the
 * shop's merchant context; nothing is sent here, so no mail call ever runs
 * inside a transaction (backend invariant #1).
 */
@Injectable()
export class NotificationComposer {
  private readonly appUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: AppConfig,
    private readonly reads: NotificationReadsRepository,
    private readonly preferences: NotificationPreferencesRepository,
    private readonly shops: ShopProfileRepository,
  ) {
    this.appUrl = config.get('APP_URL').replace(/\/+$/, '');
  }

  /** Only an order the assistant wrote; one the seller added themselves needs no email. */
  orderDrafted(merchantId: string, orderId: string): Promise<NotificationEmail[]> {
    const scope: TenantScope = { merchantId };
    return withMerchant(this.db, merchantId, async (tx) => {
      const found = await this.reads.draftedOrder(tx, scope, orderId);
      if (!found || found.source !== 'assistant') return [];
      const recipients = await this.preferences.recipients(tx, scope, 'newOrder');
      if (recipients.length === 0) return [];
      const shop = await this.shops.find(tx, scope);
      return addressed(
        recipients,
        orderDraftedEmail({
          appUrl: this.appUrl,
          shopName: shop.name,
          orderId: found.id,
          reference: found.reference,
          customerName: found.customerName,
          total: formatMinorUnits(found.total, found.currency, EMAIL_LOCALE),
        }),
      );
    });
  }

  /**
   * Only if the chat is still on this handoff - not handed back, nor handed
   * off again since - and nobody has replied since it was.
   */
  customerWaiting(
    merchantId: string,
    conversationId: string,
    handedOffAt: Date,
  ): Promise<NotificationEmail[]> {
    const scope: TenantScope = { merchantId };
    return withMerchant(this.db, merchantId, async (tx) => {
      const found = await this.reads.conversation(tx, scope, conversationId);
      if (!found || found.state !== 'handed_off') return [];
      if (found.handedOffAt?.getTime() !== handedOffAt.getTime()) return [];
      if (await this.reads.sellerRepliedSince(tx, scope, conversationId, handedOffAt)) return [];
      const recipients = await this.preferences.recipients(tx, scope, 'customerWaiting');
      if (recipients.length === 0) return [];
      const shop = await this.shops.find(tx, scope);
      return addressed(
        recipients,
        customerWaitingEmail({
          appUrl: this.appUrl,
          shopName: shop.name,
          conversationId: found.id,
          customerName: found.customerName,
          waitingMinutes: CUSTOMER_WAITING_DELAY_MS / 60_000,
        }),
      );
    });
  }

  /**
   * The shops whose 9:00 falls on the scan scheduled for `now`, with the day
   * to summarise. Each shop costs one primary-key read of its zone; only a
   * shop at its 9:00 is asked whether anyone wants the summary.
   */
  async dailySummariesDue(now: Date): Promise<{ merchantId: string; day: string }[]> {
    const due: { merchantId: string; day: string }[] = [];
    for (const merchantId of await listMerchantIds(this.db)) {
      const scope: TenantScope = { merchantId };
      const day = await withMerchant(this.db, merchantId, async (tx) => {
        const region = this.regionOrDefault(await this.reads.region(tx, scope));
        const summarised = dailySummaryDayDue(now, region.timeZone);
        if (!summarised) return null;
        const recipients = await this.preferences.recipients(tx, scope, 'dailySummary');
        return recipients.length > 0 ? summarised : null;
      });
      if (day) due.push({ merchantId, day });
    }
    return due;
  }

  /** Yesterday's orders and revenue; nothing when the shop took no orders that day. */
  dailySummary(merchantId: string, day: string): Promise<NotificationEmail[]> {
    const scope: TenantScope = { merchantId };
    return withMerchant(this.db, merchantId, async (tx) => {
      const recipients = await this.preferences.recipients(tx, scope, 'dailySummary');
      if (recipients.length === 0) return [];
      const region = this.regionOrDefault(await this.reads.region(tx, scope));
      const totals = await this.reads.dayTotals(tx, scope, day, region.timeZone);
      if (totals.orders === 0) return [];
      const shop = await this.shops.find(tx, scope);
      return addressed(
        recipients,
        dailySummaryEmail({
          appUrl: this.appUrl,
          shopName: shop.name,
          // Noon on that day, so the zone can't move it to a neighbour.
          date: formatShopDate(`${day}T12:00:00Z`, {
            dateFormat: region.dateFormat,
            timeZone: 'UTC',
          }),
          orders: totals.orders,
          revenue: formatMinorUnits(totals.revenue, region.currency, EMAIL_LOCALE),
        }),
      );
    });
  }

  private regionOrDefault(region: ShopRegion | undefined): ShopRegion {
    if (region) return region;
    const { timeZone, dateFormat, currency } = regionDefaults(DEFAULT_COUNTRY);
    return { timeZone, dateFormat, currency };
  }
}
