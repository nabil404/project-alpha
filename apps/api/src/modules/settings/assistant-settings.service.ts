import { Inject, Injectable } from '@nestjs/common';
import {
  MATCH_CUSTOMER,
  type AssistantSettings,
  type AssistantSettingsView,
  type UpdateAssistantSettings,
} from '@app/shared';
import { CodedValidationException } from '../../common/errors/coded-exceptions';
import { AppConfig } from '../config/app.config';
import type { Executor, TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { AssistantSettingsRepository } from './assistant-settings.repository';

/**
 * Settings > Order assistant: how the assistant talks to the shop's
 * customers. Which default languages exist comes from ASSISTANT_LANGUAGES.
 */
@Injectable()
export class AssistantSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: AssistantSettingsRepository,
    private readonly config: AppConfig,
  ) {}

  get(scope: TenantScope): Promise<AssistantSettingsView> {
    return withMerchant(this.db, scope.merchantId, async (tx) =>
      this.view(await this.read(tx, scope)),
    );
  }

  update(scope: TenantScope, changes: UpdateAssistantSettings): Promise<AssistantSettingsView> {
    const { defaultLanguage } = changes;
    if (defaultLanguage !== undefined && !this.allows(defaultLanguage)) {
      throw new CodedValidationException({
        defaultLanguage: [
          {
            code: 'INVALID_VALUE',
            message: 'The assistant does not support this language',
            params: { values: [MATCH_CUSTOMER, ...this.supported()].join(', ') },
          },
        ],
      });
    }
    if (Object.keys(changes).length === 0) return this.get(scope);
    return withMerchant(this.db, scope.merchantId, async (tx) =>
      this.view(this.effective(await this.settings.upsert(tx, scope, changes))),
    );
  }

  /** The shop's settings inside the caller's transaction, a language since removed reading as `match`. */
  async read(executor: Executor, scope: TenantScope): Promise<AssistantSettings> {
    return this.effective(await this.settings.find(executor, scope));
  }

  private effective(settings: AssistantSettings): AssistantSettings {
    return this.allows(settings.defaultLanguage)
      ? settings
      : { ...settings, defaultLanguage: MATCH_CUSTOMER };
  }

  private allows(language: string): boolean {
    return language === MATCH_CUSTOMER || this.supported().includes(language);
  }

  private supported(): string[] {
    return this.config.get('ASSISTANT_LANGUAGES');
  }

  private view(settings: AssistantSettings): AssistantSettingsView {
    return { ...settings, supportedLanguages: this.supported() };
  }
}
