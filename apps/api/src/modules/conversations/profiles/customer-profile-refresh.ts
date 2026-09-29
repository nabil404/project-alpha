import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import { CustomerRepository } from '../customer.repository';
import { CustomerProfileReader } from './customer-profile.reader';
import { listMerchantIds } from './merchant-ids';

/** Only customers with conversation activity this recent are refreshed. */
export const PROFILE_ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Most profiles read per shop per run, which bounds the Graph calls one run makes. */
export const PROFILE_REFRESH_BATCH = 200;
/** This many failed reads in a row stops a shop's run: its Page token is likely revoked. */
export const PROFILE_REFRESH_MAX_FAILURES = 5;

export interface MerchantRefreshReport {
  read: number;
  failed: number;
  /** Stopped early by PROFILE_REFRESH_MAX_FAILURES. */
  aborted: boolean;
}

export interface ProfileRefreshReport extends MerchantRefreshReport {
  merchants: number;
  abortedMerchants: number;
}

/**
 * Re-reads the Messenger profiles of recently active customers whose picture
 * link may have expired, or whose name Facebook has not shared yet. The daily
 * job's first run is also the backfill for customers stored before pictures.
 *
 * Order per shop follows backend invariant #1: list under merchant context,
 * then each Graph call outside any transaction, then a short one to write it.
 */
@Injectable()
export class CustomerProfileRefresh {
  private readonly logger = new Logger(CustomerProfileRefresh.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reader: CustomerProfileReader,
    private readonly pages: FacebookPageRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async refreshAll(now = new Date()): Promise<ProfileRefreshReport> {
    const report: ProfileRefreshReport = {
      merchants: 0,
      abortedMerchants: 0,
      read: 0,
      failed: 0,
      aborted: false,
    };
    if (!this.reader.available) return report;

    for (const merchantId of await listMerchantIds(this.db)) {
      const merchant = await this.refreshMerchant(merchantId, now);
      if (merchant.read + merchant.failed === 0) continue;
      report.merchants += 1;
      report.read += merchant.read;
      report.failed += merchant.failed;
      if (merchant.aborted) {
        report.abortedMerchants += 1;
        this.logger.warn(
          `Stopped refreshing customer profiles for merchant ${merchantId} after ${merchant.failed} failed reads in a row`,
        );
      }
    }
    return report;
  }

  async refreshMerchant(merchantId: string, now = new Date()): Promise<MerchantRefreshReport> {
    const scope: TenantScope = { merchantId };
    const report: MerchantRefreshReport = { read: 0, failed: 0, aborted: false };

    const { page, due } = await withMerchant(this.db, merchantId, async (tx) => {
      const page = await this.pages.findForMerchant(tx, scope);
      const due = page
        ? await this.customers.listStaleProfiles(tx, scope, {
            now,
            activeSince: new Date(now.getTime() - PROFILE_ACTIVE_WINDOW_MS),
            limit: PROFILE_REFRESH_BATCH,
          })
        : [];
      return { page, due };
    });
    if (!page) return report;

    let failedInRow = 0;
    for (const customer of due) {
      const { profile, ok } = await this.reader.read(page.accessToken, customer.psid);
      await withMerchant(this.db, merchantId, (tx) =>
        this.customers.recordProfile(tx, scope, customer.id, profile),
      );
      if (ok) {
        report.read += 1;
        failedInRow = 0;
        continue;
      }
      report.failed += 1;
      failedInRow += 1;
      if (failedInRow >= PROFILE_REFRESH_MAX_FAILURES) {
        report.aborted = true;
        break;
      }
    }
    return report;
  }
}
