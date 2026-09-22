import { Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  CodedBadRequestException,
  CodedUnauthorizedException,
} from '../../common/errors/coded-exceptions.js';
import { AppConfig } from '../../config/app.config.js';
import { MESSENGER_QUEUE, type InboundMessageJob } from '../queue/queue.constants.js';
import { verifyMetaSignature } from './signature.js';
import { parseInboundJobs, parseWebhookBody } from './webhook-payload.js';
import type { RawBodyRequest } from './raw-body.js';

/**
 * Acknowledge immediately, process in a background worker. The Meta message ID
 * is the job ID, so a redelivered webhook never produces a second job.
 */
@Controller('webhooks/messenger')
export class MessengerController {
  constructor(
    private readonly config: AppConfig,
    @InjectQueue(MESSENGER_QUEUE) private readonly queue: Queue<InboundMessageJob>,
  ) {}

  @Get()
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
