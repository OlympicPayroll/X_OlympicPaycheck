/**
 * Domain models for Olympic Paycheck.
 *
 * These are deliberately **backend-agnostic**: screens speak this language, and
 * an adapter (see `client.ts`) translates to whatever the payroll API actually
 * returns. The shapes are derived from what the legacy SOAP service exposed, so
 * we know this data genuinely exists in the payroll system.
 */

/** A company the employee is paid by (legacy: ClientAccountID / EmpID / CompName). */
export type Company = {
  /** Client account id — scopes pay stub lookups. */
  id: string;
  /** The employee's id *within this company*. */
  employeeId: string;
  name: string;
  /** Id of the most recent payroll run, used to detect "new" checks. */
  latestPayrollId: string;
};

export type Employee = {
  id: string;
  /** As stored by payroll, typically "LAST, FIRST". */
  fullName: string;
  /** Display-friendly given name. */
  firstName: string;
};

/** Result of a successful sign-in. */
export type Session = {
  employee: Employee;
  /** Employees can work for more than one company; the UI must let them pick. */
  companies: Company[];
};

/** A pay period summary, as shown in lists. */
export type Paycheck = {
  /** History id — needed to fetch the full stub. */
  id: string;
  /** Display date, e.g. "Jul 18, 2026". */
  payDate: string;
  /** Sortable ISO date, e.g. "2026-07-18". */
  payDateIso: string;
  net: number;
  /** e.g. "Direct deposit". */
  method: string;
  /** Unread — drives the NEW badge. */
  isNew: boolean;
  /** Some periods contain more than one check. */
  checkCount: number;
  /** Multiple checks merged into a single combined view. */
  isCombined: boolean;
  /** Present for unread email-delivered payrolls; used to mark as read. */
  sentId?: string;
};

export type LineItem = {
  label: string;
  /** e.g. "80.00 hrs · $30.00/hr". */
  detail?: string;
  amount: number;
};

export type YtdTotals = {
  gross: number;
  net: number;
  taxes: number;
  deductions: number;
};

/** A full pay stub. */
export type StubDetail = {
  id: string;
  payDate: string;
  net: number;
  gross: number;
  earnings: LineItem[];
  taxes: LineItem[];
  deductions: LineItem[];
  taxTotal: number;
  deductionTotal: number;
  ytd: YtdTotals;
};

/**
 * Failure modes the UI needs to distinguish. The first three mirror real
 * responses from the legacy service (IsValidEmail / IsValidSSN / EmpCount).
 */
export type ApiErrorCode =
  | 'INVALID_EMAIL'
  | 'INVALID_SSN'
  | 'MULTIPLE_EMPLOYEES'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'SERVER'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** For MULTIPLE_EMPLOYEES: how many employees share the email. */
  readonly count?: number;

  constructor(code: ApiErrorCode, message: string, count?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.count = count;
  }
}

/** Friendly, user-facing copy for an error. Never leaks internals. */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'INVALID_EMAIL':
        return 'We don’t recognize that email address. Check it and try again.';
      case 'INVALID_SSN':
        return 'That doesn’t match the last 4 digits of your SSN. Try again.';
      case 'MULTIPLE_EMPLOYEES':
        return `This email is used by ${error.count ?? 'several'} employees. Please call Olympic Payroll.`;
      case 'NOT_FOUND':
        return 'We couldn’t find that pay stub.';
      case 'NETWORK':
        return 'No internet connection. Check your network and try again.';
      default:
        return 'Something went wrong on our end. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}
