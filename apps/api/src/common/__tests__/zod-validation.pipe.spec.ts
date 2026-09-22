import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { CodedErrorBody } from '../errors/coded-exceptions.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';

const schema = z.object({ quantity: z.number().int().positive() });

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value', () => {
    expect(pipe.transform({ quantity: 2 })).toEqual({ quantity: 2 });
  });

  it('rejects invalid input with the failing paths', () => {
    expect(() => pipe.transform({ quantity: -1 })).toThrow(BadRequestException);
  });

  it('attributes each failure to its field as a coded envelope body', () => {
    let body: CodedErrorBody | undefined;
    try {
      pipe.transform({ quantity: -1 });
    } catch (error) {
      body = (error as BadRequestException).getResponse() as CodedErrorBody;
    }

    expect(body?.code).toBe('VALIDATION_FAILED');
    expect(body?.fields?.quantity?.[0]).toEqual({
      code: 'MIN_VALUE',
      message: expect.any(String),
      params: { min: 0 },
    });
  });
});
