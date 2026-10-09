import { Injectable } from '@nestjs/common';
import type { Executor, TenantScope } from '../../database/base.repository';
import { llmCall } from '../../database/schema/index';
import type { LlmCallRecord } from '../../llm/llm.types';

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
}
