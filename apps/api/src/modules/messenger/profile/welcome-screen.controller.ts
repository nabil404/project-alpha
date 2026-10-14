import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags, type SchemaObject } from '@nestjs/swagger';
import {
  welcomeScreenInputSchema,
  welcomeScreenSchema,
  type WelcomeScreen,
  type WelcomeScreenInput,
} from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../../common/tenant.guard';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { ApiCodedError } from '../../../openapi/api-coded-error';
import { WelcomeScreenService } from './welcome-screen.service';

const json = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

/** The shop comes from the session, never the request. */
@ApiTags('Settings')
@UseGuards(TenantGuard)
@Controller('settings/messenger-welcome')
export class WelcomeScreenController {
  constructor(private readonly welcome: WelcomeScreenService) {}

  @Get()
  @ApiOperation({
    summary: "Read the shop's Messenger welcome screen",
    description:
      "Greeting and ice breakers, the defaults for the shop's language until saved, and whether the Page has the latest.",
  })
  @ApiOkResponse({ schema: json(welcomeScreenSchema, 'output') })
  get(@Req() request: TenantRequest): Promise<WelcomeScreen> {
    return this.welcome.get(tenantScope(request));
  }

  @Put()
  @ApiOperation({
    summary: 'Save the welcome screen and update the Page',
    description:
      'Saves at once; the Page is updated in the background, so `profileSync.status` is `pending` until it is.',
  })
  @ApiBody({ schema: json(welcomeScreenInputSchema, 'input') })
  @ApiOkResponse({ schema: json(welcomeScreenSchema, 'output') })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  update(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(welcomeScreenInputSchema)) body: WelcomeScreenInput,
  ): Promise<WelcomeScreen> {
    return this.welcome.update(tenantScope(request), body);
  }
}
