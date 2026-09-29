import {
  HttpException,
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AVATAR_MAX_BYTES } from '@app/shared';
import type { Observable } from 'rxjs';
import {
  CodedBadRequestException,
  CodedPayloadTooLargeException,
  isCodedErrorBody,
} from '../../../common/errors/coded-exceptions';

/** Memory storage, one `file`, rejected by multer while streaming once it passes the limit. */
const MulterFileInterceptor = FileInterceptor('file', {
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
});

function translateAvatarUploadError(error: unknown): unknown {
  if (!(error instanceof HttpException) || isCodedErrorBody(error.getResponse())) {
    return error;
  }
  if (error.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
    return new CodedPayloadTooLargeException(
      'AVATAR_TOO_LARGE',
      'The image is larger than the upload limit',
      { maxBytes: AVATAR_MAX_BYTES },
    );
  }
  if (error.getStatus() === HttpStatus.BAD_REQUEST) {
    return new CodedBadRequestException(
      'AVATAR_INVALID',
      'Send exactly one image in the `file` field',
    );
  }
  return error;
}

@Injectable()
export class AvatarUploadInterceptor implements NestInterceptor {
  private readonly multer = new MulterFileInterceptor();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(context, next);
    } catch (error) {
      throw translateAvatarUploadError(error);
    }
  }
}
