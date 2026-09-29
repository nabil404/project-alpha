import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import {
  conversationCountsSchema,
  conversationDetailSchema,
  conversationFilters,
  conversationListResponseSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  messagePageSchema,
  updateConversationSchema,
  type ConversationCounts,
  type ConversationDetail,
  type ConversationListResponse,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessagePage,
  type UpdateConversation,
} from '@app/shared';
import { z, type ZodType } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { ConversationsService } from './conversations.service';

const uuidParam = new ZodValidationPipe(z.string().uuid());
const openApi = (schema: ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

/** The merchant always comes from the session via TenantGuard, never the request. */
@ApiTags('Conversations')
@UseGuards(TenantGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List conversations',
    description:
      'Newest activity first. Pass `pagination.nextCursor` back as `cursor` for the next page. `q` matches customer names and message text.',
  })
  @ApiQuery({ name: 'filter', required: false, enum: [...conversationFilters] })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', maxLength: 100 } })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
  })
  @ApiOkResponse({
    description: 'A page of conversations.',
    schema: openApi(conversationListResponseSchema),
  })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  list(
    @Req() request: TenantRequest,
    @Query(new ZodValidationPipe(listConversationsQuerySchema)) query: ListConversationsQuery,
  ): Promise<ConversationListResponse> {
    return this.conversations.list(tenantScope(request), query);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Count conversations per filter', description: 'Ignores search.' })
  @ApiOkResponse({
    description: 'Counts for the filter chips.',
    schema: openApi(conversationCountsSchema),
  })
  counts(@Req() request: TenantRequest): Promise<ConversationCounts> {
    return this.conversations.counts(tenantScope(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a conversation' })
  @ApiOkResponse({ description: 'The conversation.', schema: openApi(conversationDetailSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CONVERSATION_NOT_FOUND'])
  get(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
  ): Promise<ConversationDetail> {
    return this.conversations.get(tenantScope(request), id);
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'List a conversation’s messages',
    description:
      'The newest page, oldest first. Pass `pagination.prevCursor` back as `before` for older messages.',
  })
  @ApiQuery({ name: 'before', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiOkResponse({ description: 'A page of messages.', schema: openApi(messagePageSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CONVERSATION_NOT_FOUND'])
  messages(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ): Promise<MessagePage> {
    return this.conversations.messages(tenantScope(request), id, query);
  }

  @Put(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a conversation read', description: 'Idempotent.' })
  @ApiNoContentResponse({ description: 'Marked read.' })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CONVERSATION_NOT_FOUND'])
  markRead(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<void> {
    return this.conversations.markRead(tenantScope(request), id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Take over or hand back a conversation',
    description:
      '`botPaused: true` pauses the assistant in this chat; `false` hands it back, and a handed-off chat resumes.',
  })
  @ApiBody({ schema: openApi(updateConversationSchema, 'input') })
  @ApiOkResponse({
    description: 'The updated conversation.',
    schema: openApi(conversationDetailSchema),
  })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CONVERSATION_NOT_FOUND'])
  update(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateConversationSchema)) body: UpdateConversation,
  ): Promise<ConversationDetail> {
    return this.conversations.update(tenantScope(request), id, body);
  }
}
