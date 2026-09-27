import {
  HttpException,
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PRODUCT_IMAGE_MAX_BYTES } from '@app/shared';
import type { Observable } from 'rxjs';
import {
  CodedBadRequestException,
  CodedPayloadTooLargeException,
  isCodedErrorBody,
} from '../../../common/errors/coded-exceptions.js';

/**
 * Memory storage (the default without `dest`), one file in the `file` field,
 * rejected by multer while streaming once it passes the limit - so an oversize
 * upload is never fully buffered.
 */
const MulterFileInterceptor = FileInterceptor('file', {
  limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES, files: 1 },
});

/**
 * Multer's rejections surface as bare PayloadTooLarge/BadRequest exceptions;
 * this gives them codes so they leave the API in the envelope like everything
 * else.
 */
export function translateUploadError(error: unknown): unknown {
  if (!(error instanceof HttpException) || isCodedErrorBody(error.getResponse())) {
    return error;
  }
  if (error.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
    return new CodedPayloadTooLargeException(
      'PRODUCT_IMAGE_TOO_LARGE',
      'The image is larger than the upload limit',
      { maxBytes: PRODUCT_IMAGE_MAX_BYTES },
    );
  }
  if (error.getStatus() === HttpStatus.BAD_REQUEST) {
    return new CodedBadRequestException(
      'PRODUCT_IMAGE_INVALID',
      'Send exactly one image in the `file` field',
    );
  }
  return error;
}

@Injectable()
export class ProductImageUploadInterceptor implements NestInterceptor {
  private readonly multer = new MulterFileInterceptor();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(context, next);
    } catch (error) {
      throw translateUploadError(error);
    }
  }
}
