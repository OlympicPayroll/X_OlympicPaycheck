// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/** Jest injects these; flat config no longer honours `eslint-env` comments. */
const jestGlobals = {
  jest: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
};

module.exports = defineConfig([
  expoConfig,
  {
    files: ['__tests__/**/*.{ts,tsx}', '__mocks__/**/*.js', 'jest.setup.js'],
    languageOptions: { globals: jestGlobals },
  },
  {
    ignores: ['dist/*', 'coverage/*', '.expo/*'],
  },
]);
