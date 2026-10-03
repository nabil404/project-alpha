import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateCustomerNote,
  CustomerDetail,
  CustomerListResponse,
  CustomerNote,
  CustomerOrderPage,
  CustomerSummary,
  ListCustomerOrdersQuery,
  ListCustomersQuery,
  UpdateCustomer,
} from '@app/shared';
import type { Executor, TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { customerNotFound } from './customer-errors';
import {
  pagePagination,
  toCustomerDetail,
  toCustomerListItem,
  toCustomerNote,
  toCustomerOrder,
} from './customer-mappers';
import { CustomerNotesRepository } from './customer-notes.repository';
import { CustomersRepository } from './customers.repository';

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly customers: CustomersRepository,
    private readonly notes: CustomerNotesRepository,
  ) {}

  list(scope: TenantScope, query: ListCustomersQuery): Promise<CustomerListResponse> {
    const { page, pageSize, ...rest } = query;
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const { rows, total } = await this.customers.list(tx, scope, {
        ...rest,
        offset: (page - 1) * pageSize,
        limit: pageSize,
        now: new Date(),
      });
      return {
        data: rows.map(toCustomerListItem),
        pagination: pagePagination(page, pageSize, total),
      };
    });
  }

  summary(scope: TenantScope): Promise<CustomerSummary> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const { averageOrderValue, newInWindow, repeatCustomers, customersWithOrders, ...counts } =
        await this.customers.summary(tx, scope, new Date());
      return { counts, newInWindow, repeatCustomers, customersWithOrders, averageOrderValue };
    });
  }

  get(scope: TenantScope, id: string): Promise<CustomerDetail> {
    return withMerchant(this.db, scope.merchantId, (tx) => this.detail(tx, scope, id));
  }

  update(scope: TenantScope, id: string, input: UpdateCustomer): Promise<CustomerDetail> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.customers.updateContact(tx, scope, id, input))) throw customerNotFound(id);
      return this.detail(tx, scope, id);
    });
  }

  orders(
    scope: TenantScope,
    id: string,
    query: ListCustomerOrdersQuery,
  ): Promise<CustomerOrderPage> {
    const { page, pageSize } = query;
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.customers.exists(tx, scope, id))) throw customerNotFound(id);
      const { rows, total } = await this.customers.listOrders(tx, scope, id, {
        offset: (page - 1) * pageSize,
        limit: pageSize,
      });
      return { data: rows.map(toCustomerOrder), pagination: pagePagination(page, pageSize, total) };
    });
  }

  listNotes(scope: TenantScope, id: string): Promise<CustomerNote[]> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.customers.exists(tx, scope, id))) throw customerNotFound(id);
      return (await this.notes.list(tx, scope, id)).map(toCustomerNote);
    });
  }

  addNote(
    scope: TenantScope,
    id: string,
    author: { id: string; name: string },
    input: CreateCustomerNote,
  ): Promise<CustomerNote> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.customers.exists(tx, scope, id))) throw customerNotFound(id);
      const note = await this.notes.insert(tx, scope, {
        customerId: id,
        authorId: author.id,
        body: input.body,
      });
      return toCustomerNote({ note, author });
    });
  }

  private async detail(tx: Executor, scope: TenantScope, id: string): Promise<CustomerDetail> {
    const row = await this.customers.findById(tx, scope, id, new Date());
    if (!row) throw customerNotFound(id);
    return toCustomerDetail(row, await this.customers.latestConversation(tx, scope, id));
  }
}
