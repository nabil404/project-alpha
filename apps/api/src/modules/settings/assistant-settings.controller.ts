import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assistantSettingsViewSchema,
  updateAssistantSettingsSchema,
  type AssistantSettingsView,
  type UpdateAssistantSettings,
} from '@app/shared';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { openApiSchema } from '../../openapi/openapi-schema';
import { AssistantSettingsService } from './assistant-settings.service';

/** The merchant comes from the session, never the request. */
@ApiTags('Settings')
@UseGuards(TenantGuard)
@Controller('settings/assistant')
export class AssistantSettingsController {
  constructor(private readonly assistant: AssistantSettingsService) {}

  @Get()
  @ApiOperation({
    summary: "Read how the active shop's order assistant talks",
    description:
      'A shop that has never saved reads as the defaults: a friendly tone, the language that matches the customer, and no notes. `supportedLanguages` lists the ISO 639-1 codes `defaultLanguage` may name besides `match`.',
  })
  @ApiOkResponse({ schema: openApiSchema(assistantSettingsViewSchema) })
  get(@Req() request: TenantRequest): Promise<AssistantSettingsView> {
    return this.assistant.get(tenantScope(request));
  }

  @Patch()
  @ApiOperation({
    summary: "Change the order assistant's tone, default language or notes",
    description:
      'Omit a field to leave it alone. Notes are trimmed and hold at most 1000 characters.',
  })
  @ApiBody({ schema: openApiSchema(updateAssistantSettingsSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(assistantSettingsViewSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  update(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(updateAssistantSettingsSchema)) body: UpdateAssistantSettings,
  ): Promise<AssistantSettingsView> {
    return this.assistant.update(tenantScope(request), body);
  }
}
