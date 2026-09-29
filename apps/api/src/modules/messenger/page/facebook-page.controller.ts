import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import {
  MESSENGER_SETTINGS_PATH,
  connectFacebookPageSchema,
  facebookAuthorizationSchema,
  facebookPageCandidatesResponseSchema,
  facebookPageResponseSchema,
  facebookPageSchema,
  type ConnectFacebookPageInput,
  type ErrorCode,
  type FacebookAuthorization,
  type FacebookPage,
  type FacebookPageCandidatesResponse,
  type FacebookPageResponse,
} from '@app/shared';
import { z } from 'zod';
import { isCodedErrorBody } from '../../../common/errors/index';
import { TenantGuard, type TenantRequest } from '../../../common/tenant.guard';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { AppConfig } from '../../config/app.config';
import { ApiCodedError } from '../../../openapi/api-coded-error';
import { FacebookPageService, type PageConnectOwner } from './facebook-page.service';
import { PAGE_CONNECT_COOKIE, PAGE_CONNECT_TTL_MS, readCookie } from './page-connect-flow';

/** The controller's own path; the flow cookie is scoped to it and sent nowhere else. */
export const PAGE_ROUTE = 'messenger/page';
export const PAGE_CONNECT_CALLBACK_PATH = `/api/v1/${PAGE_ROUTE}/oauth/callback`;

const schemaOf = (schema: z.ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

function ownerOf(request: TenantRequest): PageConnectOwner {
  const userId = request.session?.user.id;
  if (!request.merchantId || !userId) {
    throw new Error('TenantGuard did not run before a tenant route');
  }
  return { merchantId: request.merchantId, userId };
}

/**
 * The shop's Facebook Page: read it, connect it through Facebook's Login
 * dialog, disconnect it. The merchant always comes from the session via
 * TenantGuard, never the request.
 *
 * Connecting takes four calls: POST /authorizations (sets the flow cookie,
 * answers Facebook's URL), Facebook's redirect to GET /oauth/callback (sends
 * the browser back to the SPA), GET /candidates, then PUT with the chosen Page.
 */
@ApiTags('Facebook Page')
@UseGuards(TenantGuard)
@Controller(PAGE_ROUTE)
export class FacebookPageController {
  private readonly logger = new Logger(FacebookPageController.name);
  private readonly appUrl: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly pages: FacebookPageService,
    @Inject(AppConfig) config: AppConfig,
  ) {
    this.appUrl = config.get('APP_URL');
    this.cookieOptions = {
      httpOnly: true,
      // Lax, not Strict: Facebook's redirect back is a cross-site top-level
      // navigation, and the callback needs this cookie on it.
      sameSite: 'lax',
      secure: this.appUrl.startsWith('https:'),
      path: `/api/v1/${PAGE_ROUTE}`,
    };
  }

  @Get()
  @ApiOperation({
    summary: "The shop's Facebook Page",
    description: '`page` is null until one is connected.',
  })
  @ApiOkResponse({ schema: schemaOf(facebookPageResponseSchema) })
  async get(@Req() request: TenantRequest): Promise<FacebookPageResponse> {
    return { page: await this.pages.get(ownerOf(request)) };
  }

  @Post('authorizations')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Start connecting a Facebook Page',
    description:
      'Sets a short-lived, encrypted flow cookie and answers the Facebook Login dialog URL to send the browser to. Facebook redirects back to `GET /messenger/page/oauth/callback`.',
  })
  @ApiCreatedResponse({ schema: schemaOf(facebookAuthorizationSchema) })
  @ApiCodedError(503, ['MESSENGER_NOT_CONFIGURED'])
  authorize(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) response: Response,
  ): FacebookAuthorization {
    const { url, cookie } = this.pages.start(ownerOf(request));
    response.cookie(PAGE_CONNECT_COOKIE, cookie, {
      ...this.cookieOptions,
      maxAge: PAGE_CONNECT_TTL_MS,
    });
    return { url };
  }

  @Get('oauth/callback')
  @ApiOperation({
    summary: "Facebook's redirect back",
    description: `Not called by clients. Redirects to \`${MESSENGER_SETTINGS_PATH}?step=choose-page\` in the dashboard, or to \`?error=<code>\` when authorization failed.`,
  })
  @ApiQuery({ name: 'code', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'state', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'error', required: false, schema: { type: 'string' } })
  @ApiFoundResponse({ description: 'Back to the dashboard.' })
  async callback(
    @Req() request: TenantRequest,
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const back = new URL(MESSENGER_SETTINGS_PATH, this.appUrl);
    try {
      const cookie = await this.pages.completeAuthorization(
        ownerOf(request),
        readCookie(request.headers.cookie, PAGE_CONNECT_COOKIE),
        { code: first(code), state: first(state), error: first(error) },
      );
      response.cookie(PAGE_CONNECT_COOKIE, cookie, {
        ...this.cookieOptions,
        maxAge: PAGE_CONNECT_TTL_MS,
      });
      back.searchParams.set('step', 'choose-page');
    } catch (thrown) {
      response.clearCookie(PAGE_CONNECT_COOKIE, this.cookieOptions);
      back.searchParams.set('error', this.errorCodeOf(thrown));
    }
    response.redirect(HttpStatus.FOUND, back.toString());
  }

  @Get('candidates')
  @ApiOperation({
    summary: 'Pages the seller can connect',
    description: 'The Pages granted on Facebook in this connection flow. Needs the flow cookie.',
  })
  @ApiOkResponse({ schema: schemaOf(facebookPageCandidatesResponseSchema) })
  @ApiCodedError(400, ['FACEBOOK_AUTH_EXPIRED'])
  @ApiCodedError(503, ['MESSENGER_NOT_CONFIGURED', 'FACEBOOK_UNAVAILABLE'])
  async candidates(@Req() request: TenantRequest): Promise<FacebookPageCandidatesResponse> {
    const pages = await this.pages.listCandidates(
      ownerOf(request),
      readCookie(request.headers.cookie, PAGE_CONNECT_COOKIE),
    );
    return { pages };
  }

  @Put()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Connect a Facebook Page',
    description:
      "Connects one of the candidates, or refreshes the token of the shop's current Page. A shop has one Page: connecting a different one needs a disconnect first. Needs the flow cookie, and ends the flow.",
  })
  @ApiBody({ schema: schemaOf(connectFacebookPageSchema, 'input') })
  @ApiOkResponse({ schema: schemaOf(facebookPageSchema) })
  @ApiCodedError(400, [
    'VALIDATION_FAILED',
    'FACEBOOK_AUTH_EXPIRED',
    'FACEBOOK_AUTH_FAILED',
    'FACEBOOK_PAGE_NO_MESSAGING_ACCESS',
  ])
  @ApiCodedError(404, ['FACEBOOK_PAGE_NOT_FOUND'])
  @ApiCodedError(409, ['FACEBOOK_PAGE_TAKEN', 'FACEBOOK_PAGE_ALREADY_CONNECTED'])
  @ApiCodedError(503, ['MESSENGER_NOT_CONFIGURED', 'FACEBOOK_UNAVAILABLE'])
  async connect(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(connectFacebookPageSchema)) body: ConnectFacebookPageInput,
  ): Promise<FacebookPage> {
    const page = await this.pages.connect(
      ownerOf(request),
      readCookie(request.headers.cookie, PAGE_CONNECT_COOKIE),
      body.pageId,
    );
    response.clearCookie(PAGE_CONNECT_COOKIE, this.cookieOptions);
    return page;
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disconnect the Facebook Page',
    description: 'Forgets the Page and its token and stops its webhooks. Idempotent.',
  })
  @ApiNoContentResponse({ description: 'Disconnected, or there was nothing to disconnect.' })
  disconnect(@Req() request: TenantRequest): Promise<void> {
    return this.pages.disconnect(ownerOf(request));
  }

  /** The coded error to hand the SPA; anything uncoded is logged and reported generically. */
  private errorCodeOf(thrown: unknown): ErrorCode {
    if (thrown instanceof HttpException) {
      const body = thrown.getResponse();
      if (isCodedErrorBody(body)) return body.code;
    }
    this.logger.error(thrown instanceof Error ? thrown.stack : String(thrown));
    return 'INTERNAL_SERVER_ERROR';
  }
}

/** Express turns a repeated query parameter into an array; only the first counts. */
function first(value: unknown): string | undefined {
  if (Array.isArray(value)) return first(value[0]);
  return typeof value === 'string' ? value : undefined;
}
