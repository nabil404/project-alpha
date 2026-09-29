import { Controller, Get, Req, type INestApplication, type LoggerService } from '@nestjs/common';
import type { Request } from 'express';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import request from 'supertest';
import { configureApp } from '../bootstrap';
import { AppConfig } from '../modules/config/app.config';
import { DATABASE } from '../modules/database/database.module';
import { HealthController } from '../modules/health/health.module';
import { MessengerController } from '../modules/messenger/messenger.controller';
import { MESSENGER_QUEUE } from '../modules/queue/queue.constants';

const VERIFY_TOKEN = 'verify-me';

const silentLogger = { error: () => {} } as unknown as LoggerService;

@Controller('demo')
class DemoController {
  @Get()
  hello() {
    return { ok: true };
  }

  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

/**
 * The public URL map, through the same configureApp() wiring main.ts uses.
 * Better Auth is mounted outside Nest routing; its path is covered by the
 * email/password e2e spec.
 */
describe('API versioning', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [DemoController, HealthController, MessengerController],
      providers: [
        { provide: DATABASE, useValue: { execute: async () => [] } },
        {
          provide: AppConfig,
          useValue: { get: (key: string) => (key === 'META_VERIFY_TOKEN' ? VERIFY_TOKEN : '') },
        },
        { provide: getQueueToken(MESSENGER_QUEUE), useValue: { add: async () => undefined } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, silentLogger);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves our routes under /api/v1', async () => {
    await request(server()).get('/api/v1/demo').expect(200, { ok: true });
  });

  // The throttler keys on req.ip; behind Caddy it must be the client, not Caddy.
  it("takes the client address from the one proxy hop's X-Forwarded-For", async () => {
    const response = await request(server())
      .get('/api/v1/demo/ip')
      .set('X-Forwarded-For', '198.51.100.7, 203.0.113.9')
      .expect(200);

    // Only the entry Caddy appended is trusted; a client-supplied one is not.
    expect(response.body.ip).toBe('203.0.113.9');
  });

  it('does not advertise Express', async () => {
    const response = await request(server()).get('/api/v1/demo').expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('answers an unversioned path with the coded 404', async () => {
    const response = await request(server()).get('/api/demo');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('HTTP_404');
  });

  it('keeps /health unprefixed and unversioned', async () => {
    const response = await request(server()).get('/health').expect(200);
    expect(response.body.status).toBe('ok');

    await request(server()).get('/v1/health').expect(404);
    await request(server()).get('/api/v1/health').expect(404);
  });

  it("completes Meta's verification handshake at /api/v1/webhooks/messenger", async () => {
    const response = await request(server())
      .get('/api/v1/webhooks/messenger')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '42' })
      .expect(200);

    expect(response.text).toBe('42');
  });

  it('no longer answers Meta at the unversioned path', async () => {
    const response = await request(server())
      .get('/api/webhooks/messenger')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '42' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('HTTP_404');
  });
});
