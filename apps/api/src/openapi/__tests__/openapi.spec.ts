import type { INestApplication, LoggerService } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import request from 'supertest';
import { configureApp } from '../../bootstrap.js';
import { AppConfig } from '../../config/app.config.js';
import { DATABASE } from '../../database/database.module.js';
import { HealthController } from '../../health/health.module.js';
import { MessengerController } from '../../modules/messenger/messenger.controller.js';
import { MESSENGER_QUEUE } from '../../modules/queue/queue.constants.js';
import { ERROR_RESPONSE_SCHEMA } from '../api-coded-error.js';
import { SESSION_COOKIE_SCHEME } from '../merge-auth-document.js';
import { OPENAPI_JSON_PATH, OPENAPI_UI_PATH, setupOpenApi } from '../openapi.js';
import { STUB_APP_URL, stubAuth } from './stub-auth.js';

const silentLogger = { error: () => {} } as unknown as LoggerService;

/** Every `$ref` value anywhere in the document. */
function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') {
        refs.push(child);
      } else {
        collectRefs(child, refs);
      }
    }
  }
  return refs;
}

/** The document a developer sees, built through the same wiring as main.ts. */
describe('OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController, MessengerController],
      providers: [
        { provide: DATABASE, useValue: { execute: async () => [] } },
        { provide: AppConfig, useValue: { get: () => '' } },
        { provide: getQueueToken(MESSENGER_QUEUE), useValue: { add: async () => undefined } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, silentLogger);
    await setupOpenApi(app, stubAuth());
    await app.init();

    const response = await request(app.getHttpServer()).get(`/${OPENAPI_JSON_PATH}`).expect(200);
    document = response.body as OpenAPIObject;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Swagger UI', async () => {
    await request(app.getHttpServer())
      .get(`/${OPENAPI_UI_PATH}`)
      .expect(200)
      .expect('content-type', /html/);
  });

  it('lists routes at the URLs they are actually served on', () => {
    expect(document.paths['/health']?.get).toBeDefined();
    expect(document.paths['/api/v1/webhooks/messenger']?.get).toBeDefined();
    expect(document.paths['/api/v1/webhooks/messenger']?.post).toBeDefined();
    expect(document.paths['/api/v1/auth/sign-up/email']?.post).toBeDefined();

    expect(Object.keys(document.paths).filter((path) => !path.startsWith('/api/v1/'))).toEqual([
      '/health',
    ]);
  });

  it('requires the session cookie unless a route is anonymous', () => {
    expect(document.security).toEqual([{ [SESSION_COOKIE_SCHEME]: [] }]);
    expect(document.components?.securitySchemes?.[SESSION_COOKIE_SCHEME]).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'better-auth.session_token',
    });

    expect(document.paths['/health']?.get?.security).toEqual([]);
    expect(document.paths['/api/v1/webhooks/messenger']?.get?.security).toEqual([]);
    expect(document.paths['/api/v1/webhooks/messenger']?.post?.security).toEqual([]);
  });

  it('documents webhook errors as the coded envelope with their codes', () => {
    const receive = document.paths['/api/v1/webhooks/messenger']?.post;

    expect(receive?.responses['401']).toEqual({
      description: expect.stringContaining('`WEBHOOK_INVALID_SIGNATURE`'),
      content: {
        'application/json': { schema: { $ref: `#/components/schemas/${ERROR_RESPONSE_SCHEMA}` } },
      },
    });
    expect(receive?.parameters).toContainEqual(
      expect.objectContaining({ in: 'header', name: 'x-hub-signature-256', required: true }),
    );
  });

  it('derives ErrorResponse from the shared envelope schema', () => {
    expect(document.components?.schemas?.[ERROR_RESPONSE_SCHEMA]).toMatchObject({
      type: 'object',
      required: ['error'],
      properties: {
        error: { required: expect.arrayContaining(['code', 'message', 'params']) },
      },
    });
  });

  it('resolves every $ref', () => {
    const schemas = document.components?.schemas ?? {};
    const dangling = collectRefs(document).filter(
      (ref) => !(ref.replace('#/components/schemas/', '') in schemas),
    );

    expect(dangling).toEqual([]);
  });
});

describe("Better Auth's own OpenAPI endpoints", () => {
  const auth = stubAuth();

  it.each(['/api/v1/auth/open-api/generate-schema', '/api/v1/auth/reference'])(
    'are not served: %s',
    async (path) => {
      const response = await auth.handler(new Request(`${STUB_APP_URL}${path}`));

      expect(response.status).toBe(404);
    },
  );
});
