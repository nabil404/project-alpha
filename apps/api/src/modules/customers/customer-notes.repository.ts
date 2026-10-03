import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import { customerNote, user, type CustomerNoteRow } from '../database/schema/index';

export interface CustomerNoteWithAuthor {
  note: CustomerNoteRow;
  author: { id: string; name: string } | null;
}

@Injectable()
export class CustomerNotesRepository {
  /** Newest first. Notes are written by hand, a handful per customer, so the list is not paginated. */
  async list(
    executor: Executor,
    { merchantId }: TenantScope,
    customerId: string,
  ): Promise<CustomerNoteWithAuthor[]> {
    return executor
      .select({ note: customerNote, author: { id: user.id, name: user.name } })
      .from(customerNote)
      .leftJoin(user, eq(user.id, customerNote.authorId))
      .where(and(eq(customerNote.merchantId, merchantId), eq(customerNote.customerId, customerId)))
      .orderBy(desc(customerNote.createdAt), desc(customerNote.id));
  }

  /** The caller has checked the customer exists; the composite key would refuse it anyway. */
  async insert(
    executor: Executor,
    { merchantId }: TenantScope,
    values: { customerId: string; authorId: string; body: string },
  ): Promise<CustomerNoteRow> {
    return one(
      await executor
        .insert(customerNote)
        .values({ merchantId, ...values })
        .returning(),
      'customer note insert',
    );
  }
}
