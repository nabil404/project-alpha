import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { WireErrorCode } from '@app/shared';

/** Registered by setupOpenApi from errorResponseBodySchema in @app/shared. */
export const ERROR_RESPONSE_SCHEMA = 'ErrorResponse';
export const ERROR_RESPONSE_REF = `#/components/schemas/${ERROR_RESPONSE_SCHEMA}`;

/**
 * Documents an error response in the coded envelope, naming the `error.code`
 * values a client can see for that status. Codes are typed, so renaming one in
 * @app/shared breaks the build here rather than leaving the docs stale.
 *
 *   @ApiCodedError(401, ['WEBHOOK_INVALID_SIGNATURE'])
 */
export function ApiCodedError(status: number, codes: readonly WireErrorCode[]) {
  return applyDecorators(
    ApiResponse({
      status,
      description: `Coded error envelope. \`error.code\`: ${codes.map((code) => `\`${code}\``).join(', ')}.`,
      schema: { $ref: ERROR_RESPONSE_REF },
    }),
  );
}
