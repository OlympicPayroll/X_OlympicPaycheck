/**
 * Backend selection.
 *
 * `client.ts` decides once, at import time, so each case loads a fresh copy of
 * the module under the environment it describes. The rule under test: the demo
 * banner flag and the release guard must never disagree with the adapter that
 * `getApi()` actually returns.
 */

type ClientModule = typeof import('@/api/client');

const ORIGINAL_URL = process.env.EXPO_PUBLIC_API_URL;

function loadClient(): ClientModule {
  let client!: ClientModule;
  jest.isolateModules(() => {
    client = require('@/api/client');
  });
  return client;
}

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = ORIGINAL_URL;
});

it('runs on fixtures, and says so, when no URL is configured', () => {
  delete process.env.EXPO_PUBLIC_API_URL;

  const client = loadClient();

  expect(client.IS_MOCK_BACKEND).toBe(true);
});

/**
 * Setting the URL used to switch the demo banner off and satisfy the release
 * guard while `getApi()` went on returning fixtures, so a build could show
 * invented pay with nothing on screen to say so.
 */
it('refuses to start when a URL is set but no adapter can use it', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://payroll.example.test';

  expect(loadClient).toThrow(/HTTP payroll adapter has not been implemented/);
});
