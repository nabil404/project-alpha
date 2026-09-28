import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { serializeRequest } from '../request-log';

describe('serializeRequest', () => {
  const oauthCallback = {
    id: 1,
    method: 'GET',
    url: '/api/v1/messenger/page/oauth/callback?code=SECRETCODE&state=SECRETSTATE',
    query: { code: 'SECRETCODE', state: 'SECRETSTATE' },
    params: { token: 'SECRETPARAM' },
    headers: { host: 'orders.example.com' },
    remoteAddress: '203.0.113.9',
    remotePort: 443,
  };

  it('masks credentials in the URL', () => {
    expect(serializeRequest(oauthCallback).url).toBe(
      '/api/v1/messenger/page/oauth/callback?code=[REDACTED]&state=[REDACTED]',
    );
  });

  it('drops the parsed query and route params', () => {
    const logged = serializeRequest(oauthCallback);

    expect(logged).not.toHaveProperty('query');
    expect(logged).not.toHaveProperty('params');
    expect(JSON.stringify(logged)).not.toMatch(/SECRET/);
  });

  it('keeps the fields that identify the request', () => {
    expect(serializeRequest(oauthCallback)).toMatchObject({
      id: 1,
      method: 'GET',
      headers: { host: 'orders.example.com' },
      remoteAddress: '203.0.113.9',
      remotePort: 443,
    });
  });
});

/**
 * Through pino-http itself, which is what hands the serializer `query`: the
 * leak this guards against only showed up there, not in redactUrl's own tests.
 */
describe('request logging', () => {
  let server: Server;
  let logged: Promise<string>;

  beforeAll(async () => {
    let lines = '';
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines += chunk.toString();
        done();
      },
    });
    const logRequest = pinoHttp({ serializers: { req: serializeRequest } }, sink);

    logged = new Promise((resolve) => {
      server = createServer((req, res) => {
        // What Express puts on the request before pino-http serializes it.
        Object.assign(req, {
          query: Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams),
        });
        logRequest(req, res);
        // Registered after pino-http's own listener, so the line is written by now.
        res.on('finish', () => resolve(lines));
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("never writes Meta's verify token or an OAuth code", async () => {
    const { port } = server.address() as AddressInfo;
    await fetch(
      `http://127.0.0.1:${port}/api/v1/webhooks/messenger` +
        '?hub.mode=subscribe&hub.verify_token=SECRETTOKEN&hub.challenge=42&code=SECRETCODE',
    );

    const log = await logged;
    expect(log).toContain('hub.verify_token=[REDACTED]');
    expect(log).not.toMatch(/SECRET/);
  });
});
