import { Controller, Get, Query, type INestApplication, type LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { configureApp } from '../bootstrap.js';
import { CodedUnauthorizedException } from '../common/errors/coded-exceptions.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

const querySchema = z.object({ quantity: z.coerce.number().int().positive() });

const silentLogger = { error: () => {} } as unknown as LoggerService;

@Controller('demo')
class DemoController {
  @Get('coded')
  coded(): never {
    throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
  }

  @Get('validated')
  validated(@Query(new ZodValidationPipe(querySchema)) query: { quantity: number }) {
    return query;
  }

  @Get('bug')
  bug(): never {
    throw new Error('connection string postgres://app:hunter2@db/app');
  }
}

/**
 * The envelope as a client actually receives it — every branch of the filter
 * over real HTTP, through the same configureApp() wiring main.ts uses.
 */
describe('error envelope over HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DemoController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, silentLogger);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends a thrown code with its status', async () => {
    const response = await request(app.getHttpServer()).get('/api/demo/coded');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        params: {},
      },
    });
  });

  it('attributes a validation failure to the field that failed', async () => {
    const response = await request(app.getHttpServer()).get('/api/demo/validated?quantity=-1');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.fields.quantity[0]).toMatchObject({
      code: 'MIN_VALUE',
      params: { min: 0 },
    });
  });

  it('gives an unmatched route the HTTP_<status> fallback rather than Nest default body', async () => {
    const response = await request(app.getHttpServer()).get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('HTTP_404');
  });

  it('reduces an unexpected error to INTERNAL_SERVER_ERROR with nothing leaked', async () => {
    const response = await request(app.getHttpServer()).get('/api/demo/bug');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error', params: {} },
    });
    expect(response.text).not.toContain('hunter2');
  });

  it('passes a healthy response through untouched', async () => {
    const response = await request(app.getHttpServer()).get('/api/demo/validated?quantity=3');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ quantity: 3 });
  });
});
