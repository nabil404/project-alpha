import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

const components: Record<string, SchemaObject> = {};

/**
 * A Zod schema as OpenAPI, for `@ApiBody` and `@Api*Response`. Every schema
 * that carries `.meta({ id })` becomes a named component referenced by
 * `$ref`, so it is listed under Schemas instead of inlined per route.
 *
 * Zod gives a schema the same id in either `io`. When the input and output
 * shapes differ, the name cannot hold both, so this throws.
 */
export function openApiSchema(
  schema: z.ZodType,
  io: 'input' | 'output' = 'output',
): SchemaObject | ReferenceObject {
  const json = JSON.parse(
    JSON.stringify(z.toJSONSchema(schema, { target: 'openapi-3.0', io })).replaceAll(
      '"#/definitions/',
      '"#/components/schemas/',
    ),
  ) as SchemaObject & { $schema?: string; definitions?: Record<string, SchemaObject> };
  const { definitions = {}, $schema: _, ...root } = json;

  for (const [name, definition] of Object.entries(definitions)) {
    const registered = components[name];
    if (registered && JSON.stringify(registered) !== JSON.stringify(definition)) {
      throw new Error(
        `OpenAPI schema "${name}" differs as ${io}; give the ${io} schema its own id`,
      );
    }
    components[name] = definition;
  }
  return root;
}

/** Every named schema documented so far, for `components.schemas`. */
export function openApiComponents(): Record<string, SchemaObject> {
  return { ...components };
}
