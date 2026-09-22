import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppConfig } from '../../config/app.config.js';
import { MESSENGER_QUEUE, type InboundMessageJob } from '../queue/queue.constants.js';
import { verifyMetaSignature } from './signature.js';
import { parseInboundJobs } from './webhook-payload.js';
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
      throw new UnauthorizedException();
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
      throw new BadRequestException('Missing raw body');
    }

    if (!verifyMetaSignature(rawBody, signature, this.config.get('META_APP_SECRET'))) {
      throw new UnauthorizedException('Invalid signature');
    }

    for (const job of parseInboundJobs(JSON.parse(rawBody.toString('utf8')))) {
      await this.queue.add('inbound-message', job, { jobId: job.messageId });
    }

    return 'EVENT_RECEIVED';
  }
}
