import type { Response } from 'express';
import type { TenantRequest } from '../../../../common/tenant.guard';
import type { AppConfig } from '../../../../config/app.config';
import { FacebookPageController } from '../facebook-page.controller';
import { facebookAuthCancelled } from '../facebook-page-errors';
import type { FacebookPageService } from '../facebook-page.service';

/** Records what the controller did to the response. */
function fakeResponse() {
  const log = {
    cookies: [] as { name: string; value: string; options: Record<string, unknown> }[],
    cleared: [] as string[],
    redirect: null as { status: number; url: string } | null,
  };
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) =>
      log.cookies.push({ name, value, options }),
    clearCookie: (name: string) => log.cleared.push(name),
    redirect: (status: number, url: string) => {
      log.redirect = { status, url };
    },
  } as unknown as Response;
  return { response, log };
}

const request = {
  merchantId: 'merchant-a',
  session: { user: { id: 'user-a' } },
  headers: { cookie: 'page_connect=sealed-flow' },
} as unknown as TenantRequest;

const config = (appUrl: string) => ({ get: () => appUrl }) as unknown as AppConfig;

describe('FacebookPageController', () => {
  it('starts the flow with an httpOnly, Lax cookie scoped to the Page routes', () => {
    const service = { start: () => ({ url: 'https://facebook.test/dialog', cookie: 'sealed' }) };
    const controller = new FacebookPageController(
      service as unknown as FacebookPageService,
      config('https://shop.test'),
    );
    const { response, log } = fakeResponse();

    expect(controller.authorize(request, response)).toEqual({
      url: 'https://facebook.test/dialog',
    });
    expect(log.cookies).toEqual([
      {
        name: 'page_connect',
        value: 'sealed',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: '/api/v1/messenger/page',
          maxAge: 15 * 60 * 1000,
        },
      },
    ]);
  });

  it('sends the browser back to choose a Page after a good callback', async () => {
    const calls: unknown[] = [];
    const service = {
      completeAuthorization: async (...args: unknown[]) => {
        calls.push(args);
        return 'sealed-authorized';
      },
    };
    const controller = new FacebookPageController(
      service as unknown as FacebookPageService,
      config('http://localhost:5173'),
    );
    const { response, log } = fakeResponse();

    await controller.callback(request, response, 'the-code', 'the-state');

    expect(calls).toEqual([
      [
        { merchantId: 'merchant-a', userId: 'user-a' },
        'sealed-flow',
        { code: 'the-code', state: 'the-state', error: undefined },
      ],
    ]);
    expect(log.cookies[0]).toMatchObject({
      value: 'sealed-authorized',
      options: { secure: false },
    });
    expect(log.redirect).toEqual({
      status: 302,
      url: 'http://localhost:5173/settings/messenger?step=choose-page',
    });
  });

  it('sends the error code back and drops the flow when the callback fails', async () => {
    const service = {
      completeAuthorization: async () => {
        throw facebookAuthCancelled();
      },
    };
    const controller = new FacebookPageController(
      service as unknown as FacebookPageService,
      config('http://localhost:5173'),
    );
    const { response, log } = fakeResponse();

    await controller.callback(request, response, undefined, 'the-state', 'access_denied');

    expect(log.cleared).toEqual(['page_connect']);
    expect(log.redirect?.url).toBe(
      'http://localhost:5173/settings/messenger?error=FACEBOOK_AUTH_CANCELLED',
    );
  });
});
