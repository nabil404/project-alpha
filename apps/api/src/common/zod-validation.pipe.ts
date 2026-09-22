import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { CodedValidationException } from './errors/coded-exceptions.js';
import { zodIssuesToFields } from './errors/validation-fields.js';

/**
 * Validation is Zod everywhere: the same schemas from @app/shared back API
 * input, the forms in the SPA, and LLM output.
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createProductSchema)) body: CreateProduct) {}
 *
 * A failure becomes VALIDATION_FAILED with a `fields` map, so the SPA can put
 * each message on the form control it belongs to.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new CodedValidationException(zodIssuesToFields(result.error.issues));
    }

    return result.data;
  }
}
