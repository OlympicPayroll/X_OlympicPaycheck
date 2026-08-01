const expoPreset = require('jest-expo/jest-preset');

/**
 * Jest configuration for Olympic Paycheck.
 *
 * `jest-expo` is pinned to the SDK (54.x) and derives its transform, module
 * mapping and asset handling from the installed Expo/React Native versions —
 * including turning the `@/*` aliases in tsconfig.json into module mappings.
 * That mapping is spread in below so adding our own entries can't drop it.
 *
 * Tests live in the top-level `__tests__/` directory rather than beside the
 * source: anything under `src/app/` is a route to Expo Router, and test files
 * have no business being reachable as screens.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/__tests__/**/*.test.{ts,tsx}'],
  moduleNameMapper: {
    // First match wins: this has to precede the `@/*` alias mapping, or
    // `@/global.css` resolves to the real stylesheet and Jest tries to parse it.
    '\\.css$': '<rootDir>/__mocks__/style-mock.js',
    ...expoPreset.moduleNameMapper,
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    // Fixture backend — exercised by the tests, but its own coverage is noise.
    '!src/api/mock.ts',
  ],
};
