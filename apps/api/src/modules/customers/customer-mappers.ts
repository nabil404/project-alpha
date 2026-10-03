import type {
  CustomerDetail,
  CustomerListItem,
  CustomerNote,
  CustomerOrder,
  PagePagination,
} from '@app/shared';
import type { ConversationRow } from '../database/schema/index';
import type { CustomerNoteWithAuthor } from './customer-notes.repository';
import type { CustomerOrderRow, CustomerStatsRow } from './customers.repository';

export function toCustomerListItem(row: CustomerStatsRow): CustomerListItem {
  const { customer } = row;
  return {
    id: customer.id,
    name: customer.name,
    pictureUrl: customer.pictureUrl,
    phone: customer.phone,
    area: customer.area,
    status: row.status,
    orderCount: row.orderCount,
    totalSpent: row.totalSpent,
    lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
    lastActiveAt: row.lastActiveAt.toISOString(),
  };
}

export function toCustomerDetail(
  row: CustomerStatsRow,
  latest: ConversationRow | null,
): CustomerDetail {
  return {
    ...toCustomerListItem(row),
    deliveryAddress: row.customer.deliveryAddress,
    averageOrderValue: row.orderCount > 0 ? Math.round(row.totalSpent / row.orderCount) : null,
    createdAt: row.customer.createdAt.toISOString(),
    latestConversation: latest && {
      id: latest.id,
      state: latest.state,
      botPaused: latest.botPaused,
      lastMessage: {
        preview: latest.lastMessagePreview,
        sender: latest.lastMessageSender,
        at: latest.lastMessageAt.toISOString(),
      },
    },
  };
}

export function toCustomerOrder({ order, items }: CustomerOrderRow): CustomerOrder {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    total: order.total,
    placedAt: order.placedAt.toISOString(),
    items,
  };
}

export function toCustomerNote({ note, author }: CustomerNoteWithAuthor): CustomerNote {
  return { id: note.id, body: note.body, author, createdAt: note.createdAt.toISOString() };
}

export function pagePagination(page: number, pageSize: number, total: number): PagePagination {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
