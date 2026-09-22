import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({ quantity: z.number().int().positive() });

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value', () => {
    expect(pipe.transform({ quantity: 2 })).toEqual({ quantity: 2 });
  });

  it('rejects invalid input with the failing paths', () => {
    expect(() => pipe.transform({ quantity: -1 })).toThrow(BadRequestException);
  });
});
