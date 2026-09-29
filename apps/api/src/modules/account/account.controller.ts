import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import {
  accountAvatarSchema,
  deviceSessionSchema,
  type AccountAvatar,
  type DeviceSession,
} from '@app/shared';
import { z } from 'zod';
import { CodedValidationException } from '../../common/errors/coded-exceptions';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { AvatarUploadInterceptor } from './avatar/avatar-upload.interceptor';
import { AvatarService } from './avatar/avatar.service';
import { DeviceSessionsService } from './sessions/device-sessions.service';

interface SignedInRequest extends Request {
  /** Better Auth's `{ session, user }`, put there by SessionGuard. */
  session?: UserSession | null;
}

/** Better Auth session ids are random strings, not uuids. */
const sessionIdParam = new ZodValidationPipe(z.string().min(1).max(255));

const schemaOf = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'output' }) as SchemaObject;

function signedIn(request: SignedInRequest): { userId: string; sessionId: string } {
  const session = request.session;
  if (!session) {
    throw new Error('SessionGuard did not run before an account route');
  }
  return { userId: session.user.id, sessionId: session.session.id };
}

/**
 * The signed-in seller's own account: their photo and their devices. No
 * TenantGuard - this belongs to the user, not the shop - and every id comes
 * from the session, never the request.
 */
@ApiTags('Account')
@Controller('account')
export class AccountController {
  constructor(
    private readonly avatars: AvatarService,
    private readonly devices: DeviceSessionsService,
  ) {}

  @Put('avatar')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseInterceptors(AvatarUploadInterceptor)
  @ApiOperation({
    summary: 'Set the profile photo',
    description:
      'One JPEG, PNG or WebP image (max 5 MB, at least 256 × 256). The server strips all metadata and stores a 512px square JPEG.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ description: 'The new photo URL.', schema: schemaOf(accountAvatarSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED', 'AVATAR_INVALID', 'AVATAR_TOO_SMALL'])
  @ApiCodedError(413, ['AVATAR_TOO_LARGE'])
  @ApiCodedError(415, ['AVATAR_UNSUPPORTED_TYPE'])
  @ApiCodedError(503, ['STORAGE_UNAVAILABLE'])
  uploadAvatar(
    @Req() request: SignedInRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<AccountAvatar> {
    if (!file) {
      throw new CodedValidationException({
        file: [{ code: 'REQUIRED', message: 'Attach an image in the `file` field', params: {} }],
      });
    }
    return this.avatars.upload(signedIn(request).userId, file.buffer);
  }

  @Delete('avatar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the profile photo' })
  @ApiOkResponse({ description: '`image` is null.', schema: schemaOf(accountAvatarSchema) })
  removeAvatar(@Req() request: SignedInRequest): Promise<AccountAvatar> {
    return this.avatars.remove(signedIn(request).userId);
  }

  @Get('sessions')
  @ApiOperation({
    summary: 'List signed-in devices',
    description:
      'Unexpired sessions, the current one first. Never includes tokens or IP addresses.',
  })
  @ApiOkResponse({ schema: { type: 'array', items: schemaOf(deviceSessionSchema) } })
  listSessions(@Req() request: SignedInRequest): Promise<DeviceSession[]> {
    const { userId, sessionId } = signedIn(request);
    return this.devices.list(userId, sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign a device out' })
  @ApiNoContentResponse({ description: 'Signed out.' })
  @ApiCodedError(404, ['SESSION_NOT_FOUND'])
  @ApiCodedError(409, ['SESSION_IS_CURRENT'])
  revokeSession(
    @Req() request: SignedInRequest,
    @Param('id', sessionIdParam) id: string,
  ): Promise<void> {
    const { userId, sessionId } = signedIn(request);
    return this.devices.revoke(userId, sessionId, id);
  }
}
