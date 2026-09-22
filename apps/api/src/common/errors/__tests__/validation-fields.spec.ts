import { z } from 'zod';
import { zodIssuesToFields } from '../validation-fields.js';

/** Returns the fields map a failing parse would produce. */
function fieldsFor(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error('expected the schema to reject this value');
  }
  return zodIssuesToFields(result.error.issues);
}

describe('zodIssuesToFields', () => {
  it('reports a missing property as REQUIRED rather than a type mismatch', () => {
    const fields = fieldsFor(z.object({ name: z.string() }), {});

    expect(fields.name).toEqual([{ code: 'REQUIRED', message: expect.any(String), params: {} }]);
  });

  it('carries the raw constraint argument through as params', () => {
    const fields = fieldsFor(z.object({ password: z.string().min(12) }), { password: 'short' });

    expect(fields.password).toEqual([
      { code: 'MIN_LENGTH', message: expect.any(String), params: { min: 12 } },
    ]);
  });

  it('distinguishes a string length from a collection size and a numeric bound', () => {
    const schema = z.object({
      name: z.string().min(2),
      items: z.array(z.string()).min(1),
      quantity: z.number().min(1),
    });

    const fields = fieldsFor(schema, { name: 'a', items: [], quantity: 0 });

    expect(fields.name?.[0]?.code).toBe('MIN_LENGTH');
    expect(fields.items?.[0]?.code).toBe('MIN_ITEMS');
    expect(fields.quantity?.[0]?.code).toBe('MIN_VALUE');
  });

  it('keys a nested failure by its dotted path', () => {
    const schema = z.object({ items: z.array(z.object({ quantity: z.number().int() })) });

    const fields = fieldsFor(schema, { items: [{ quantity: 1.5 }] });

    expect(Object.keys(fields)).toEqual(['items.0.quantity']);
  });

  it('groups every rule that failed on the same field', () => {
    const fields = fieldsFor(z.object({ email: z.string().min(20).email() }), { email: 'nope' });

    expect(fields.email?.map((error) => error.code)).toEqual(['MIN_LENGTH', 'INVALID_FORMAT']);
  });

  it('keys an issue about the whole body under _root', () => {
    const fields = fieldsFor(z.object({ name: z.string() }), 'not an object');

    expect(Object.keys(fields)).toEqual(['_root']);
  });

  it('degrades an unmapped issue to INVALID_INPUT instead of throwing', () => {
    const schema = z.object({ name: z.string() }).refine(() => false, { message: 'nope' });

    const fields = fieldsFor(schema, { name: 'ok' });

    expect(fields._root?.[0]).toEqual({ code: 'INVALID_INPUT', message: 'nope', params: {} });
  });
});
