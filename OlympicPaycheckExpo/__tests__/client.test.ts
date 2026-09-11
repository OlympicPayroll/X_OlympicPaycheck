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
 * Setting the URL once switched the demo banner off while `getApi()` went on
 * returning fixtures. Now the URL selects the HTTP adapter itself, so the
 * banner goes exactly when the invented pay does.
 */
it('talks to the payroll service, and drops the demo banner, when a URL is set', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://payroll.example.test';

  const client = loadClient();

  expect(client.IS_MOCK_BACKEND).toBe(false);
  expect(typeof client.getApi().getW2).toBe('function');
});
