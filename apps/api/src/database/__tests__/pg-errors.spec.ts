import { DrizzleQueryError } from 'drizzle-orm/errors';
import { uniqueViolationConstraint } from '../pg-errors';
import { one } from '../rows';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error('pg'), { code, constraint });

describe('uniqueViolationConstraint', () => {
  it('names the constraint of a bare unique violation', () => {
    expect(uniqueViolationConstraint(pgError('23505', 'x_uidx'))).toBe('x_uidx');
  });

  it('reads through the DrizzleQueryError wrapper', () => {
    const wrapped = new DrizzleQueryError('insert ...', [], pgError('23505', 'x_uidx'));
    expect(uniqueViolationConstraint(wrapped)).toBe('x_uidx');
  });

  it('ignores other SQLSTATEs', () => {
    expect(uniqueViolationConstraint(pgError('23503', 'x_fk'))).toBeNull();
  });

  it('ignores non-errors', () => {
    expect(uniqueViolationConstraint(undefined)).toBeNull();
    expect(uniqueViolationConstraint('23505')).toBeNull();
  });
});

describe('one', () => {
  it('returns the only row', () => {
    expect(one([{ id: 1 }], 'thing')).toEqual({ id: 1 });
  });

  it('throws, naming the query, when there is no row', () => {
    expect(() => one([], 'thing insert')).toThrow(/thing insert/);
  });
});
