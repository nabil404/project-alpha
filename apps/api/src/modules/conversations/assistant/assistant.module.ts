import { Module } from '@nestjs/common';
import { LlmModule } from '../../llm/llm.module';
import { FacebookPageModule } from '../../messenger/page/facebook-page.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { QueueModule } from '../../queue/queue.module';
import { SettingsModule } from '../../settings/settings.module';
import { ConversationsModule } from '../conversations.module';
import { AssistantTurnProcessor } from './assistant-turn.processor';
import { AssistantTurnService } from './assistant-turn.service';
import { LlmCallRepository } from './llm-call.repository';

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [
    QueueModule,
    LlmModule,
    FacebookPageModule,
    ConversationsModule,
    SettingsModule,
    NotificationsModule,
  ],
  providers: [LlmCallRepository, AssistantTurnService, AssistantTurnProcessor],
})
export class AssistantModule {}
