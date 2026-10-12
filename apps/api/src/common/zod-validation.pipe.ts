import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { CodedValidationException } from './errors/coded-exceptions';
import { zodIssuesToFields } from './errors/validation-fields';

/**
 * Validates with a Zod schema from @app/shared, the same one the SPA's forms use:
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createProductSchema)) body: CreateProduct) {}
 *
 * A failure becomes VALIDATION_FAILED with a `fields` map for the form controls.
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
