import { Injectable } from '@nestjs/common';
import {
  ASSISTANT_SETTINGS_DEFAULTS,
  type AssistantSettings,
  type UpdateAssistantSettings,
} from '@app/shared';
import { eq } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { assistantSettings } from '../database/schema/index';

const fields = {
  tone: assistantSettings.tone,
  defaultLanguage: assistantSettings.defaultLanguage,
  notes: assistantSettings.notes,
} as const;

/** The shop's assistant settings; a shop with no row reads as ASSISTANT_SETTINGS_DEFAULTS. */
@Injectable()
export class AssistantSettingsRepository {
  async find(executor: Executor, { merchantId }: TenantScope): Promise<AssistantSettings> {
    const [row] = await executor
      .select(fields)
      .from(assistantSettings)
      .where(eq(assistantSettings.merchantId, merchantId));
    return row ?? { ...ASSISTANT_SETTINGS_DEFAULTS };
  }

  /** Writes the fields sent; a first write fills the rest from the defaults. */
  async upsert(
    executor: Executor,
    { merchantId }: TenantScope,
    changes: UpdateAssistantSettings,
  ): Promise<AssistantSettings> {
    const [row] = await executor
      .insert(assistantSettings)
      .values({ merchantId, ...ASSISTANT_SETTINGS_DEFAULTS, ...changes })
      .onConflictDoUpdate({
        target: assistantSettings.merchantId,
        set: { ...changes, updatedAt: new Date() },
      })
      .returning(fields);
    if (!row) throw new Error('upsert assistant_settings returned no row');
    return row;
  }
}
