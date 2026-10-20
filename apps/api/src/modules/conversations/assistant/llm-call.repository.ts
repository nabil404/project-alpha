import { Injectable } from '@nestjs/common';
import { and, count, eq, gte } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { llmCall } from '../../database/schema/index';
import type { LlmCallRecord, LlmPurpose } from '../../llm/llm.types';

@Injectable()
export class LlmCallRepository {
  /** A turn's calls, written in the turn's own short transaction. */
  async insertMany(
    executor: Executor,
    { merchantId }: TenantScope,
    conversationId: string,
    calls: LlmCallRecord[],
  ): Promise<void> {
    if (calls.length === 0) return;
    await executor
      .insert(llmCall)
      .values(calls.map((call) => ({ ...call, merchantId, conversationId })));
  }

  /** An import run's calls, one per post read, written in that post's transaction. */
  async insertForImport(
    executor: Executor,
    { merchantId }: TenantScope,
    importId: string,
    calls: LlmCallRecord[],
  ): Promise<void> {
    if (calls.length === 0) return;
    await executor.insert(llmCall).values(calls.map((call) => ({ ...call, merchantId, importId })));
  }

  /** How many calls for this purpose the conversation made since `since`, failed ones included. */
  async countSince(
    executor: Executor,
    { merchantId }: TenantScope,
    conversationId: string,
    purpose: LlmPurpose,
    since: Date,
  ): Promise<number> {
    const [row] = await executor
      .select({ calls: count() })
      .from(llmCall)
      .where(
        and(
          eq(llmCall.merchantId, merchantId),
          eq(llmCall.conversationId, conversationId),
          eq(llmCall.purpose, purpose),
          gte(llmCall.createdAt, since),
        ),
      );
    return Number(row?.calls ?? 0);
  }
}
