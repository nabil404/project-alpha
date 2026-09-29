import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto.service';
import { META_GRAPH } from '../../messenger/page/facebook-page.service';
import type { MetaGraphClient } from '../../messenger/page/meta-graph.client';
import type { CustomerProfile } from '../customer.repository';

/** `ok` is false when Facebook could not be asked or refused; the profile then carries nulls. */
export interface ProfileRead {
  profile: CustomerProfile;
  ok: boolean;
}

/**
 * Reads a customer's Messenger profile with the Page token. Never throws: a
 * customer without a name or picture is still a customer. A network call, so
 * never call it inside a transaction (backend invariant #1).
 */
@Injectable()
export class CustomerProfileReader {
  private readonly logger = new Logger(CustomerProfileReader.name);

  constructor(
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
  ) {}

  /** False when the Messenger app is not configured, so there is nobody to ask. */
  get available(): boolean {
    return this.graph !== null;
  }

  async read(encryptedPageToken: string, psid: string): Promise<ProfileRead> {
    const fetchedAt = new Date();
    const none = { name: null, pictureUrl: null, fetchedAt };
    if (!this.graph) return { profile: none, ok: false };
    try {
      const profile = await this.graph.getUserProfile(
        this.crypto.decrypt(encryptedPageToken),
        psid,
      );
      return { profile: { ...profile, fetchedAt }, ok: true };
    } catch (error) {
      this.logger.warn(
        `Customer profile not read: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return { profile: none, ok: false };
    }
  }
}
