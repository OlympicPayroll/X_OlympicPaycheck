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
  /**
   * How the money was delivered, e.g. "Direct deposit" or "Paper check".
   *
   * The stub screen needs this to label the headline amount honestly — a bonus
   * paid by paper check is not a deposit. Optional because a combined view
   * spanning several delivery methods has no single answer.
   */
  method?: string;
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
 * An annual tax form the employer has issued, or will issue, to the employee.
 *
 * Only W-2s exist today; `form` leaves room for a corrected W-2c or a 1099
 * without reshaping the list.
 */
export type TaxDocument = {
  /** Opaque id, used to fetch the form itself. */
  id: string;
  form: 'W-2';
  taxYear: number;
  employerName: string;
  /**
   * A year's W-2 stays `pending` until the employer furnishes it. That is due
   * by January 31 of the following year (the next business day when it falls
   * on a weekend), so the current year's form is always still to come.
   */
  status: 'available' | 'pending';
  /** When it was issued, or the date it is due by, e.g. "Feb 2, 2026". */
  date: string;
};

/** An amount reported under a code, e.g. box 12 "D" (401(k) deferrals). */
export type CodedAmount = { code: string; amount: number };

/** A labelled amount, e.g. box 14 "FLI". The labels are the employer's own. */
export type LabelledAmount = { label: string; amount: number };

/** One state line of a W-2 (boxes 15–20). */
export type W2State = {
  /** Two-letter code, e.g. "NJ". */
  state: string;
  employerStateId: string;
  wages: number;
  incomeTax: number;
  /** Boxes 18–20, only where a locality taxes wages. */
  localWages?: number;
  localIncomeTax?: number;
  locality?: string;
};

/**
 * Form W-2, Wage and Tax Statement: the employee's copy.
 *
 * Fields follow the boxes of the printed form, so the screen and the PDF can be
 * checked against a paper W-2 box by box. Amounts are dollars.
 */
export type W2 = {
  id: string;
  taxYear: number;
  employee: {
    /** Box e. */
    firstName: string;
    lastName: string;
    /** Box f, one entry per line. */
    address: string[];
    /**
     * Box a, truncated to the last four digits ("XXX-XX-4821"), as the IRS
     * allows on employee copies. The app never receives the full number.
     */
    ssnMasked: string;
  };
  employer: {
    /** Box c. */
    name: string;
    address: string[];
    /** Box b. */
    ein: string;
  };
  /** Box d. */
  controlNumber?: string;
  /** Box 1. */
  wages: number;
  /** Box 2. */
  federalIncomeTax: number;
  /** Box 3. */
  socialSecurityWages: number;
  /** Box 4. */
  socialSecurityTax: number;
  /** Box 5. */
  medicareWages: number;
  /** Box 6. */
  medicareTax: number;
  /** Box 7. */
  socialSecurityTips: number;
  /** Box 8. */
  allocatedTips: number;
  /** Box 10. */
  dependentCareBenefits: number;
  /** Box 11. */
  nonqualifiedPlans: number;
  /** Box 12: up to four coded amounts per form. */
  box12: CodedAmount[];
  /** Box 13. */
  statutoryEmployee: boolean;
  retirementPlan: boolean;
  thirdPartySickPay: boolean;
  /** Box 14 "Other". New Jersey employers report the employee's state contributions here. */
  box14: LabelledAmount[];
  /** Boxes 15–20. */
  states: W2State[];
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
