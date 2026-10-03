import {
  HttpException,
  HttpStatus,
  mixin,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ErrorCode } from '@app/shared';
import type { Observable } from 'rxjs';
import {
  CodedBadRequestException,
  CodedPayloadTooLargeException,
  isCodedErrorBody,
} from './errors/coded-exceptions';

export interface ImageUploadOptions {
  maxBytes: number;
  /** Sent when the file passes `maxBytes`, with `{ maxBytes }`. */
  tooLargeCode: ErrorCode;
  /** Sent for a malformed multipart body: no file, two files, another field name. */
  invalidCode: ErrorCode;
  /** What the image is, for the messages: "image", "logo". */
  noun: string;
}

/**
 * One image in the `file` field, held in memory and rejected by multer while
 * streaming once it passes the limit. Multer's own errors leave as the coded
 * envelope with the caller's codes, so each upload names its own failure.
 */
export function ImageUploadInterceptor({
  maxBytes,
  tooLargeCode,
  invalidCode,
  noun,
}: ImageUploadOptions): Type<NestInterceptor> {
  const MulterFileInterceptor = FileInterceptor('file', {
    limits: { fileSize: maxBytes, files: 1 },
  });

  function translate(error: unknown): unknown {
    if (!(error instanceof HttpException) || isCodedErrorBody(error.getResponse())) {
      return error;
    }
    if (error.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
      return new CodedPayloadTooLargeException(
        tooLargeCode,
        `The ${noun} is larger than the upload limit`,
        { maxBytes },
      );
    }
    if (error.getStatus() === HttpStatus.BAD_REQUEST) {
      return new CodedBadRequestException(
        invalidCode,
        `Send exactly one ${noun} in the \`file\` field`,
      );
    }
    return error;
  }

  class ImageUpload implements NestInterceptor {
    private readonly multer = new MulterFileInterceptor();

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      try {
        return await this.multer.intercept(context, next);
      } catch (error) {
        throw translate(error);
      }
    }
  }

  return mixin(ImageUpload);
}
