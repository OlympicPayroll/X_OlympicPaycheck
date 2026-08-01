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
 * Active backend.
 *
 * TODO(backend): replace `mockApi` with `httpApi` once Olympic Payroll provides
 * the base URL, endpoint contract and auth scheme for the API their current
 * Employee Access app uses. That is the only line that needs to change.
 */
export function getApi(): PayrollApi {
  return mockApi;
}

/** True while we're running on fixtures rather than a real payroll backend. */
export const IS_MOCK_BACKEND = true;
