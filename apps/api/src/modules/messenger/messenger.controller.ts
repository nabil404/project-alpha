import { Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import {
  CodedBadRequestException,
  CodedUnauthorizedException,
} from '../../common/errors/coded-exceptions.js';
import { AppConfig } from '../../config/app.config.js';
import { ApiCodedError } from '../../openapi/api-coded-error.js';
import { MESSENGER_QUEUE, type InboundMessageJob } from '../queue/queue.constants.js';
import { verifyMetaSignature } from './signature.js';
import { parseInboundJobs, parseWebhookBody } from './webhook-payload.js';
import type { RawBodyRequest } from './raw-body.js';

/**
 * Acknowledge immediately, process in a background worker. The Meta message ID
 * is the job ID, so a redelivered webhook never produces a second job.
 *
 * Meta carries no session: the verify token and the HMAC signature are this
 * controller's authentication, hence @AllowAnonymous().
 */
@AllowAnonymous()
@ApiTags('Messenger webhook')
@Controller('webhooks/messenger')
export class MessengerController {
  constructor(
    private readonly config: AppConfig,
    @InjectQueue(MESSENGER_QUEUE) private readonly queue: Queue<InboundMessageJob>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Meta subscription handshake',
    description: 'Called by Meta when the webhook is (re)subscribed. Echoes `hub.challenge`.',
    security: [],
  })
  @ApiQuery({ name: 'hub.mode', enum: ['subscribe'] })
  @ApiQuery({ name: 'hub.verify_token', schema: { type: 'string' } })
  @ApiQuery({ name: 'hub.challenge', schema: { type: 'string' } })
  @ApiOkResponse({
    description: 'The `hub.challenge` value, verbatim.',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  @ApiCodedError(401, ['WEBHOOK_VERIFICATION_FAILED'])
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode !== 'subscribe' || token !== this.config.get('META_VERIFY_TOKEN')) {
      throw new CodedUnauthorizedException(
        'WEBHOOK_VERIFICATION_FAILED',
        'Webhook verification failed',
      );
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive Messenger events',
    description:
      "Meta's Page webhook payload, authenticated by its HMAC signature rather than a " +
      'session. Messages are queued and processed by the worker; a redelivery is a no-op.',
    security: [],
  })
  @ApiHeader({
    name: 'x-hub-signature-256',
    required: true,
    description: '`sha256=<hex>` HMAC of the raw body, keyed with the Meta app secret.',
  })
  @ApiBody({
    description: "Meta's Page webhook payload (`object: 'page'`, `entry[].messaging[]`).",
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOkResponse({
    description: 'Accepted.',
    content: { 'text/plain': { schema: { type: 'string', enum: ['EVENT_RECEIVED'] } } },
  })
  @ApiCodedError(400, ['WEBHOOK_MISSING_RAW_BODY', 'WEBHOOK_MALFORMED_PAYLOAD'])
  @ApiCodedError(401, ['WEBHOOK_INVALID_SIGNATURE'])
  async receive(
    @Req() request: RawBodyRequest,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<string> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new CodedBadRequestException('WEBHOOK_MISSING_RAW_BODY', 'Missing raw body');
    }

    if (!verifyMetaSignature(rawBody, signature, this.config.get('META_APP_SECRET'))) {
      throw new CodedUnauthorizedException('WEBHOOK_INVALID_SIGNATURE', 'Invalid signature');
    }

    const payload = parseWebhookBody(rawBody);
    if (!payload) {
      throw new CodedBadRequestException(
        'WEBHOOK_MALFORMED_PAYLOAD',
        'Webhook body is not a JSON object',
      );
    }

    for (const job of parseInboundJobs(payload)) {
      await this.queue.add('inbound-message', job, { jobId: job.messageId });
    }

    return 'EVENT_RECEIVED';
  }
}
