/**
 * @nestjs/throttler ships CommonJS that require()s the ESM-only @nestjs/common,
 * which Jest's runtime cannot load before Node 24.9 (Node itself can, so the
 * app is unaffected). jest.config.mjs maps the package here: route decorators
 * become no-ops, and no spec exercises rate limiting.
 */
const noopDecorator = (): MethodDecorator & ClassDecorator => () => undefined;

export const Throttle = (_options?: unknown) => noopDecorator();
export const SkipThrottle = (_skip?: unknown) => noopDecorator();
