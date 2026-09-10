import Constants from 'expo-constants';

import { mockApi } from '@/api/mock';
import type { Paycheck, Session, StubDetail } from '@/api/types';

/**
 * The contract every payroll backend must satisfy.
 *
 * Screens depend on THIS, never on a concrete backend. When Olympic Payroll
 * gives us the real API, we add one `http.ts` implementing this interface and
 * change the single line in `getApi()` below — no screen changes.
 *
 * Each method maps to a capability the legacy SOAP service already had, so we
 * know the payroll system can serve it.
 */
export interface PayrollApi {
  /**
   * Authenticate and return the employee + the companies they're paid by.
   *
   * Supply `ssnLast4` normally. After repeated failures the UI escalates and
   * sends `ssnFull` instead — the full 9 digits, verified server-side.
   * (The legacy app downloaded the real SSN and compared it on the device;
   * we deliberately never do that.)
   */
  signIn(params: { email: string; ssnLast4?: string; ssnFull?: string }): Promise<Session>;

  /** Most recent pay period for an employee. */
  getLatestPaycheck(params: { employeeId: string }): Promise<Paycheck>;

  /** Years that have payroll history, newest first. */
  getPayYears(params: { employeeId: string }): Promise<number[]>;

  /** Pay periods within a year, newest first. */
  getPaychecks(params: { employeeId: string; year: number }): Promise<Paycheck[]>;

  /** Full stub detail for one pay period. */
  getStub(params: { companyId: string; paycheckId: string }): Promise<StubDetail>;

  /** When a period holds more than one check, the individual checks. */
  getChecksForDate(params: { employeeId: string; payDateIso: string }): Promise<Paycheck[]>;

  /** Multiple checks presented as a single combined stub. */
  getCombinedStub(params: { employeeId: string; payDateIso: string }): Promise<StubDetail>;

  /** Clear the unread/NEW flag once the employee opens a payroll. */
  markPaycheckRead(params: { sentId: string }): Promise<void>;

  /** Email a copy of a stub to the employee's address on file. */
  emailStub(params: { sentId: string }): Promise<void>;

  /** Profile photo as a displayable URI, or null if none is set. */
  getPhoto(params: { employeeId: string }): Promise<string | null>;

  /** Upload a new profile photo (base64, no data: prefix). */
  uploadPhoto(params: { employeeId: string; base64: string }): Promise<void>;
}

/**
 * Which backend this build talks to.
 *
 * Chosen by configuration rather than by editing code: `EXPO_PUBLIC_API_URL`
 * (or `extra.apiUrl` in app.json) names a real payroll service; its absence
 * means fixtures.
 */
const API_URL: string | undefined =
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl?.trim() ||
  undefined;

/**
 * The adapter for this build, chosen once at startup.
 *
 * A URL with no adapter to use it is a misconfiguration, not a reason to keep
 * serving fixtures quietly: that combination hid the demo banner and got past
 * the release guard below while employees saw invented pay. It fails here
 * instead, until `httpApi` exists.
 */
function selectApi(): PayrollApi {
  if (API_URL) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is set, but the HTTP payroll adapter has not been implemented yet. ' +
        'Remove the URL to run on fixture data, or implement httpApi in src/api/ and return it from selectApi().',
    );
  }
  return mockApi;
}

const activeApi = selectApi();

/**
 * True while we're running on fixtures rather than a real payroll backend.
 *
 * Derived from the adapter actually in use, so the demo banner and the release
 * guard can never disagree with what `getApi()` returns.
 */
export const IS_MOCK_BACKEND = activeApi === mockApi;

/**
 * Demo builds may run on fixtures; store builds may not.
 *
 * The `preview` EAS profile sets `EXPO_PUBLIC_ALLOW_FIXTURES` so the team can
 * keep handing round an internal build while the real backend contract is
 * still being obtained. `production` deliberately does not, so a store binary
 * built before the adapter exists fails loudly at startup rather than showing
 * employees somebody else's invented pay as if it were their own.
 *
 * Keyed on `__DEV__` rather than NODE_ENV because that is the flag Metro
 * actually flips for a release bundle.
 */
const FIXTURES_ALLOWED = __DEV__ || process.env.EXPO_PUBLIC_ALLOW_FIXTURES === '1';

if (IS_MOCK_BACKEND && !FIXTURES_ALLOWED) {
  throw new Error(
    'Olympic Paycheck was built without EXPO_PUBLIC_API_URL, so it would show fixture payroll. ' +
      'Set the payroll API URL for this build profile before releasing.',
  );
}

/**
 * Active backend.
 *
 * TODO(backend): implement `httpApi` against this interface once Olympic
 * Payroll provides the base URL, endpoint contract and auth scheme for the API
 * their current Employee Access app uses, then return it from `selectApi()`
 * when `API_URL` is set.
 */
export function getApi(): PayrollApi {
  return activeApi;
}
