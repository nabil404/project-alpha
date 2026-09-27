import {
  BadRequestException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PRODUCT_IMAGE_MAX_BYTES } from '@app/shared';
import { CodedNotFoundException } from '../../../../common/errors/coded-exceptions.js';
import { translateUploadError } from '../product-image-upload.interceptor.js';

const bodyOf = (error: unknown) => (error as HttpException).getResponse();

describe('translateUploadError', () => {
  it("turns multer's size limit into PRODUCT_IMAGE_TOO_LARGE with the limit", () => {
    const translated = translateUploadError(new PayloadTooLargeException('File too large'));

    expect((translated as HttpException).getStatus()).toBe(413);
    expect(bodyOf(translated)).toEqual({
      code: 'PRODUCT_IMAGE_TOO_LARGE',
      message: expect.any(String),
      params: { maxBytes: PRODUCT_IMAGE_MAX_BYTES },
    });
  });

  it("turns multer's other rejections (extra files, unexpected field) into PRODUCT_IMAGE_INVALID", () => {
    const translated = translateUploadError(new BadRequestException('Unexpected field'));

    expect((translated as HttpException).getStatus()).toBe(400);
    expect(bodyOf(translated)).toMatchObject({ code: 'PRODUCT_IMAGE_INVALID' });
  });

  it('passes coded exceptions and non-HTTP errors through untouched', () => {
    const coded = new CodedNotFoundException('PRODUCT_NOT_FOUND', 'Product not found');
    const bug = new Error('boom');

    expect(translateUploadError(coded)).toBe(coded);
    expect(translateUploadError(bug)).toBe(bug);
  });

  it('leaves other uncoded statuses alone', () => {
    const notFound = new NotFoundException();
    expect(translateUploadError(notFound)).toBe(notFound);
  });
});
