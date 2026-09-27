/** NestJS 12 is ESM-only, so the tests run through ts-jest's ESM preset. */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // CommonJS that require()s ESM; see the stub for why.
    '^@nestjs/throttler$': '<rootDir>/src/__tests__/stubs/nestjs-throttler.ts',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts'],
};
