import { z } from 'zod';
import { openApiComponents, openApiSchema } from '../openapi-schema';

describe('openApiSchema', () => {
  it('lists a schema with an id as a component and references it', () => {
    const price = z.object({ amount: z.number() }).meta({ id: 'SpecPrice' });
    const item = z.object({ name: z.string(), price }).meta({ id: 'SpecItem' });

    expect(openApiSchema(item)).toEqual({ $ref: '#/components/schemas/SpecItem' });
    expect(openApiComponents()).toMatchObject({
      SpecItem: { properties: { price: { $ref: '#/components/schemas/SpecPrice' } } },
      SpecPrice: { properties: { amount: { type: 'number' } } },
    });
  });

  it('inlines a schema without an id', () => {
    expect(openApiSchema(z.object({ q: z.string() }), 'input')).toMatchObject({
      type: 'object',
      properties: { q: { type: 'string' } },
    });
  });

  it('refuses one id for different input and output shapes', () => {
    const settings = z.object({ mode: z.string().default('auto') }).meta({ id: 'SpecSettings' });
    openApiSchema(settings, 'output');

    expect(() => openApiSchema(settings, 'input')).toThrow('"SpecSettings" differs as input');
  });
});
