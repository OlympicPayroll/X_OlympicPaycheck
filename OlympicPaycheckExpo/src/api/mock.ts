import {
  ApiError,
  type LineItem,
  type Paycheck,
  type Session,
  type StubDetail,
  type TaxDocument,
  type W2,
  type YtdTotals,
} from '@/api/types';

/**
 * Fixture-backed implementation of `PayrollApi`, used until Olympic Payroll
 * provides the real backend. It deliberately simulates latency and failure so
 * loading and error states are exercised during development.
 *
 * All people, companies and figures here are fictional.
 *
 * **Every figure is derived, never invented twice.** A check's net pay is
 * computed as gross − taxes − deductions, and the summary a list row shows is
 * the same computation the stub screen shows, so the app's arithmetic can be
 * spot-checked line by line against it. Anything that doesn't add up on screen
 * is a bug in the app, not in the data.
 *
 * Test hooks:
 *   • email containing "unknown"  → INVALID_EMAIL
 *   • ssn "0000"                  → INVALID_SSN
 *   • email containing "shared"   → MULTIPLE_EMPLOYEES
 *   • email containing "solo"     → single-company employee
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Random-ish latency so loading states look realistic. */
const latency = () => delay(350 + Math.random() * 350);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const COMPANIES = [
  { id: 'CA-1041', employeeId: 'E-88214', name: 'Cascade Coffee Roasters', latestPayrollId: 'PR-90233' },
  { id: 'CA-2277', employeeId: 'E-90551', name: 'Northgate Catering Co.', latestPayrollId: 'PR-90240' },
];

const YEARS = [2026, 2025, 2024, 2023];
/** The year the fixture set treats as "now". */
const CURRENT_YEAR = YEARS[0];
/** Fixed "today", so the same period always produces the same fixtures. */
const TODAY = new Date(2026, 6, 28);

const REGULAR_HOURS = 80;
const HOURLY_RATE = 30;

/** A pay period can hold a regular check and, occasionally, a bonus check. */
type CheckKind = 'regular' | 'bonus';

/** Round to cents. Every figure passes through this, so totals stay exact. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Two-decimal rounding for non-monetary quantities, e.g. hours worked. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sum(items: LineItem[]): number {
  return money(items.reduce((total, item) => total + item.amount, 0));
}

function fmt(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Deterministic pseudo-random so the same period always yields the same figures. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 1000) / 1000;
}

/** Biweekly pay dates for a year, newest first. */
function payDatesFor(year: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(year, 0, 3);
  while (cursor.getFullYear() === year) {
    if (cursor <= TODAY) {
      dates.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      );
    }
    cursor.setDate(cursor.getDate() + 14);
  }
  return dates.reverse();
}

/* -------------------------------------------------------------------------- */
/* Pay period shape                                                           */
/* -------------------------------------------------------------------------- */

type Period = {
  iso: string;
  /** 0 = most recent period overall; drives the "new" flag and multi-check rule. */
  index: number;
  kinds: CheckKind[];
  /** Several checks presented merged into one stub rather than as a list. */
  combined: boolean;
};

const periodCache = new Map<string, Period[]>();

/** Every pay period in a year for one employee, newest first. */
function periodsFor(employeeId: string, year: number): Period[] {
  const key = `${employeeId}|${year}`;
  const cached = periodCache.get(key);
  if (cached) return cached;

  const periods = payDatesFor(year).map((iso, i) => {
    // Only the current year can hold the single unread "latest" payroll.
    const index = year === CURRENT_YEAR ? i : i + 1;
    // Every 6th period carries a bonus check alongside the regular one.
    const multi = index > 0 && index % 6 === 0;
    return {
      iso,
      index,
      kinds: (multi ? ['regular', 'bonus'] : ['regular']) as CheckKind[],
      combined: multi && seeded(`${employeeId}|${iso}`) > 0.5,
    };
  });

  periodCache.set(key, periods);
  return periods;
}

function periodAt(employeeId: string, iso: string): Period | undefined {
  return periodsFor(employeeId, Number(iso.slice(0, 4))).find((p) => p.iso === iso);
}

/* -------------------------------------------------------------------------- */
/* Check ids                                                                  */
/* -------------------------------------------------------------------------- */

/** How a check's money reached the employee. Bonus runs are cut on paper. */
function methodFor(kind: CheckKind): string {
  return kind === 'bonus' ? 'Paper check' : 'Direct deposit';
}

/** e.g. "H-20260718-regular-E-88214". Screens treat these as opaque. */
function checkId(employeeId: string, iso: string, kind: CheckKind): string {
  return `H-${iso.replace(/-/g, '')}-${kind}-${employeeId}`;
}

const CHECK_ID = /^H-(\d{4})(\d{2})(\d{2})-(regular|bonus)-(.+)$/;

function parseCheckId(id: string): { iso: string; kind: CheckKind; employeeId: string } | null {
  const match = CHECK_ID.exec(id);
  if (!match) return null;
  const [, y, m, d, kind, employeeId] = match;
  return { iso: `${y}-${m}-${d}`, kind: kind as CheckKind, employeeId };
}

/* -------------------------------------------------------------------------- */
/* Figures                                                                    */
/* -------------------------------------------------------------------------- */

type Figures = {
  earnings: LineItem[];
  taxes: LineItem[];
  deductions: LineItem[];
  gross: number;
  taxTotal: number;
  deductionTotal: number;
  net: number;
};

/**
 * New Jersey's employee-paid payroll contributions, by year.
 *
 * Olympic Payroll's clients are largely New Jersey employers, and every NJ pay
 * stub and W-2 carries three of these: unemployment and workforce funds
 * (UI/WF/SWF), temporary disability (DI) and family leave (FLI). The rates and
 * wage bases are the ones NJ Labor and Workforce Development published for each
 * year. Each contribution stops once the year's wages pass its base, as it does
 * on a real stub.
 */
const NJ_CONTRIBUTIONS: Record<number, { ui: number; uiBase: number; di: number; fli: number; diFliBase: number }> = {
  2023: { ui: 0.00425, uiBase: 41_100, di: 0, fli: 0.0006, diFliBase: 156_800 },
  2024: { ui: 0.00425, uiBase: 42_300, di: 0, fli: 0.0009, diFliBase: 161_400 },
  2025: { ui: 0.00425, uiBase: 43_300, di: 0.0023, fli: 0.0033, diFliBase: 165_400 },
  2026: { ui: 0.00425, uiBase: 44_800, di: 0.0019, fli: 0.0023, diFliBase: 171_100 },
};

/** The order a period's checks are paid in. */
const KIND_ORDER: CheckKind[] = ['regular', 'bonus'];

/** Wages paid on earlier checks in the same calendar year: what NJ's wage bases are measured against. */
function wagesBefore(employeeId: string, iso: string, kind: CheckKind): number {
  let total = 0;
  for (const period of periodsFor(employeeId, Number(iso.slice(0, 4)))) {
    for (const k of period.kinds) {
      const earlier = period.iso < iso || (period.iso === iso && KIND_ORDER.indexOf(k) < KIND_ORDER.indexOf(kind));
      if (earlier) total += sum(earningsFor(employeeId, period.iso, k));
    }
  }
  return money(total);
}

/** A contribution on this check's wages, counting only wages up to the year's base. */
function capped(rate: number, base: number, before: number, wages: number): number {
  return money(rate * (Math.min(base, before + wages) - Math.min(base, before)));
}

const figuresCache = new Map<string, Figures>();

/**
 * Everything one check pays and withholds.
 *
 * `net` is derived last, so gross − taxes − deductions is exact by construction.
 */
function figuresFor(employeeId: string, iso: string, kind: CheckKind): Figures {
  const key = `${employeeId}|${iso}|${kind}`;
  const cached = figuresCache.get(key);
  if (cached) return cached;

  const earnings = earningsFor(employeeId, iso, kind);
  const gross = sum(earnings);
  const nj = NJ_CONTRIBUTIONS[Number(iso.slice(0, 4))] ?? NJ_CONTRIBUTIONS[CURRENT_YEAR];
  const before = wagesBefore(employeeId, iso, kind);

  const taxes = (
    [
      { label: 'Federal income', amount: money(gross * 0.1222) },
      { label: 'Social Security', amount: money(gross * 0.062) },
      { label: 'Medicare', amount: money(gross * 0.0145) },
      { label: 'State income', amount: money(gross * 0.0485) },
      { label: 'NJ UI/WF/SWF', detail: 'Unemployment & workforce', amount: capped(nj.ui, nj.uiBase, before, gross) },
      { label: 'NJ DI', detail: 'Disability insurance', amount: capped(nj.di, nj.diFliBase, before, gross) },
      { label: 'NJ FLI', detail: 'Family leave insurance', amount: capped(nj.fli, nj.diFliBase, before, gross) },
    ] as LineItem[]
  ).filter(
    // Nothing is withheld at a 0% rate (DI in 2023–24) or once wages pass a base.
    (tax) => tax.amount > 0,
  );

  // Benefits come out of the regular check only — a bonus run doesn't
  // re-charge the employee's health premium.
  const deductions: LineItem[] =
    kind === 'bonus'
      ? []
      : [
          { label: 'Health insurance', amount: 68 },
          { label: '401(k) · 4%', amount: money(gross * 0.04) },
        ];

  const taxTotal = sum(taxes);
  const deductionTotal = sum(deductions);

  const figures = {
    earnings,
    taxes,
    deductions,
    gross,
    taxTotal,
    deductionTotal,
    net: money(gross - taxTotal - deductionTotal),
  };
  figuresCache.set(key, figures);
  return figures;
}

/** What one check pays, before anything is withheld. */
function earningsFor(employeeId: string, iso: string, kind: CheckKind): LineItem[] {
  const r = seeded(`${employeeId}|${iso}|${kind}`);

  if (kind === 'bonus') return [{ label: 'Bonus', amount: money(250 + r * 500) }];

  const regular: LineItem = {
    label: 'Regular',
    detail: `${REGULAR_HOURS.toFixed(2)} hrs · $${HOURLY_RATE.toFixed(2)}/hr`,
    amount: money(REGULAR_HOURS * HOURLY_RATE),
  };
  if (r <= 0) return [regular];

  // Round the hours FIRST, then pay for the hours we printed. Deriving the
  // amount from the unrounded value made the stub fail its own arithmetic:
  // "0.34 hrs · $45.00/hr … $15.12".
  const hours = round2(r * 6);
  const rate = HOURLY_RATE * 1.5;
  return [
    regular,
    { label: 'Overtime', detail: `${hours.toFixed(2)} hrs · $${rate.toFixed(2)}/hr`, amount: money(hours * rate) },
  ];
}

/** Year-to-date totals across every check up to and including `iso`. */
function ytdThrough(employeeId: string, iso: string): YtdTotals {
  const year = Number(iso.slice(0, 4));
  let gross = 0;
  let taxes = 0;
  let deductions = 0;

  for (const period of periodsFor(employeeId, year)) {
    if (period.iso > iso) continue;
    for (const kind of period.kinds) {
      const f = figuresFor(employeeId, period.iso, kind);
      gross += f.gross;
      taxes += f.taxTotal;
      deductions += f.deductionTotal;
    }
  }

  gross = money(gross);
  taxes = money(taxes);
  deductions = money(deductions);
  return { gross, taxes, deductions, net: money(gross - taxes - deductions) };
}

function buildStub(employeeId: string, iso: string, kind: CheckKind): StubDetail {
  const f = figuresFor(employeeId, iso, kind);
  return {
    id: checkId(employeeId, iso, kind),
    payDate: fmt(iso),
    method: methodFor(kind),
    net: f.net,
    gross: f.gross,
    earnings: f.earnings,
    taxes: f.taxes,
    deductions: f.deductions,
    taxTotal: f.taxTotal,
    deductionTotal: f.deductionTotal,
    ytd: ytdThrough(employeeId, iso),
  };
}

/** Merge a period's checks into the single stub the combined view shows. */
function buildCombinedStub(employeeId: string, period: Period): StubDetail {
  const parts = period.kinds.map((kind) => figuresFor(employeeId, period.iso, kind));

  /** Same-label line items add together; the rest are appended. */
  const merge = (lists: LineItem[][]): LineItem[] => {
    const out: LineItem[] = [];
    for (const item of lists.flat()) {
      const existing = out.find((o) => o.label === item.label);
      if (existing) existing.amount = money(existing.amount + item.amount);
      else out.push({ ...item });
    }
    return out;
  };

  const earnings = merge(parts.map((p) => p.earnings));
  const taxes = merge(parts.map((p) => p.taxes));
  const deductions = merge(parts.map((p) => p.deductions));
  const gross = sum(earnings);
  const taxTotal = sum(taxes);
  const deductionTotal = sum(deductions);

  const methods = [...new Set(period.kinds.map(methodFor))];

  return {
    id: `${checkId(employeeId, period.iso, 'regular')}-combined`,
    payDate: fmt(period.iso),
    // Only claim a single delivery method when the merged checks agree on one.
    method: methods.length === 1 ? methods[0] : undefined,
    net: money(gross - taxTotal - deductionTotal),
    gross,
    earnings,
    taxes,
    deductions,
    taxTotal,
    deductionTotal,
    ytd: ytdThrough(employeeId, period.iso),
  };
}

/**
 * Delivery id for a period, or undefined when nothing was delivered.
 *
 * Only the most recent payroll has one in these fixtures, mirroring the
 * legacy service: `sentId` identifies an email delivery, and older runs were
 * cleared long ago.
 */
function sentIdFor(employeeId: string, period: Period): string | undefined {
  // Scoped to the employee: a delivery is one payroll sent to one person, so
  // two colleagues paid on the same date must not share an id — marking one
  // read would clear the other's badge too.
  return period.index === 0 ? `S-${period.iso.replace(/-/g, '')}-${employeeId}` : undefined;
}

/**
 * Deliveries the employee has opened.
 *
 * Module-level, so it behaves like server state: `markPaycheckRead` used to
 * just wait and resolve, which meant "open the payroll, come back, badge is
 * still there" was indistinguishable from a broken invalidation. Keyed by
 * delivery id — the same thing the real API marks.
 */
const readDeliveries = new Set<string>();

/** The list-row summary for a whole pay period (all its checks together). */
function summarise(employeeId: string, period: Period): Paycheck {
  const net = money(
    period.kinds.reduce((total, kind) => total + figuresFor(employeeId, period.iso, kind).net, 0),
  );
  const sentId = sentIdFor(employeeId, period);
  const methods = [...new Set(period.kinds.map(methodFor))];

  return {
    id: checkId(employeeId, period.iso, period.kinds[0]),
    payDate: fmt(period.iso),
    payDateIso: period.iso,
    net,
    method: methods.length === 1 ? methods[0] : 'Multiple methods',
    isNew: period.index === 0 && !!sentId && !readDeliveries.has(sentId),
    checkCount: period.kinds.length,
    isCombined: period.combined,
    sentId,
  };
}

/** Delivery ids look like "S-20260718-E-88214", and nothing else does. */
const DELIVERY_ID = /^S-\d{8}-.+$/;

function assertDeliveryId(sentId: string): void {
  if (!DELIVERY_ID.test(sentId)) {
    throw new ApiError('NOT_FOUND', `Not a delivery id: ${sentId}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Annual tax documents                                                       */
/* -------------------------------------------------------------------------- */

type Employer = { name: string; ein: string; stateId: string; address: string[] };

/**
 * Employers as they print on a W-2. The EINs use prefixes the IRS does not
 * issue (07 and 09), so they can never be a real employer's number. New
 * Jersey's employer ID is the federal EIN followed by a three-digit suffix.
 */
const EMPLOYERS: Record<string, Employer> = {
  'E-88214': {
    name: 'Cascade Coffee Roasters',
    ein: '07-3187654',
    stateId: '073-187-654/000',
    address: ['1200 Harbor Point Drive', 'Fairfield, NJ 07004'],
  },
  'E-90551': {
    name: 'Northgate Catering Co.',
    ein: '09-4471230',
    stateId: '094-471-230/000',
    address: ['310 Mill Pond Lane', 'Wayne, NJ 07470'],
  },
};

/** For an employee id the fixtures don't know, such as one a test invents. */
const OTHER_EMPLOYER: Employer = {
  name: 'Sample Employer LLC',
  ein: '07-0000001',
  stateId: '070-000-001/000',
  address: ['1 Sample Plaza', 'Newark, NJ 07102'],
};

/** The W-2 recipient as payroll holds them: fictional, like everything here. */
const W2_EMPLOYEE: W2['employee'] = {
  firstName: 'SARAH',
  lastName: 'MITCHELL',
  address: ['118 Linden Avenue, Apt 2B', 'Montclair, NJ 07042'],
  ssnMasked: 'XXX-XX-4821',
};

function employerFor(employeeId: string): Employer {
  return EMPLOYERS[employeeId] ?? OTHER_EMPLOYER;
}

/**
 * When a year's W-2s are due to employees: January 31 of the following year,
 * or the next business day when that falls on a weekend.
 */
function furnishBy(taxYear: number): string {
  const due = new Date(taxYear + 1, 0, 31);
  while (due.getDay() === 0 || due.getDay() === 6) due.setDate(due.getDate() + 1);
  return `${MONTHS[due.getMonth()]} ${due.getDate()}, ${due.getFullYear()}`;
}

/** A year's W-2 is issued once the year has closed; the current year's is still to come. */
function w2Issued(taxYear: number): boolean {
  return taxYear < CURRENT_YEAR;
}

/** e.g. "W2-2025-E-88214". Screens treat these as opaque. */
function w2Id(employeeId: string, taxYear: number): string {
  return `W2-${taxYear}-${employeeId}`;
}

const W2_ID = /^W2-(\d{4})-(.+)$/;

/** The lines matching a label, summed across a year's checks. */
function yearTotal(checks: Figures[], lines: (f: Figures) => LineItem[], matches: (label: string) => boolean): number {
  return money(checks.reduce((total, f) => total + sum(lines(f).filter((line) => matches(line.label))), 0));
}

/**
 * A year's W-2, added up from the very stubs the app shows.
 *
 * How the boxes relate to the stubs:
 *   • 401(k) deferrals come out of federal and New Jersey wages (boxes 1 and
 *     16) but not out of Social Security or Medicare wages (boxes 3 and 5).
 *   • Health insurance is taken after tax in these fixtures, so it moves no box.
 *   • NJ's employee contributions go in box 14, labelled as NJ W-2s print them.
 */
function buildW2(employeeId: string, taxYear: number): W2 {
  const checks = periodsFor(employeeId, taxYear).flatMap((period) =>
    period.kinds.map((kind) => figuresFor(employeeId, period.iso, kind)),
  );
  const gross = money(checks.reduce((total, f) => total + f.gross, 0));
  const withheld = (label: string) => yearTotal(checks, (f) => f.taxes, (l) => l === label);
  const deferrals = yearTotal(checks, (f) => f.deductions, (l) => l.startsWith('401(k)'));
  const employer = employerFor(employeeId);

  return {
    id: w2Id(employeeId, taxYear),
    taxYear,
    employee: { ...W2_EMPLOYEE, address: [...W2_EMPLOYEE.address] },
    employer: { name: employer.name, ein: employer.ein, address: [...employer.address] },
    controlNumber: `${taxYear}-${employeeId.replace(/\D/g, '')}`,
    wages: money(gross - deferrals),
    federalIncomeTax: withheld('Federal income'),
    socialSecurityWages: gross,
    socialSecurityTax: withheld('Social Security'),
    medicareWages: gross,
    medicareTax: withheld('Medicare'),
    socialSecurityTips: 0,
    allocatedTips: 0,
    dependentCareBenefits: 0,
    nonqualifiedPlans: 0,
    box12: deferrals > 0 ? [{ code: 'D', amount: deferrals }] : [],
    statutoryEmployee: false,
    retirementPlan: deferrals > 0,
    thirdPartySickPay: false,
    box14: [
      { label: 'UI/WF/SWF', amount: withheld('NJ UI/WF/SWF') },
      { label: 'DI', amount: withheld('NJ DI') },
      { label: 'FLI', amount: withheld('NJ FLI') },
    ].filter((line) => line.amount > 0),
    states: [
      {
        state: 'NJ',
        employerStateId: employer.stateId,
        wages: money(gross - deferrals),
        incomeTax: withheld('State income'),
      },
    ],
  };
}

/** One W-2 per payroll year, newest first, the current year's still pending. */
function taxDocumentsFor(employeeId: string): TaxDocument[] {
  const { name } = employerFor(employeeId);
  return YEARS.map(
    (taxYear): TaxDocument => ({
      id: w2Id(employeeId, taxYear),
      form: 'W-2',
      taxYear,
      employerName: name,
      status: w2Issued(taxYear) ? 'available' : 'pending',
      date: furnishBy(taxYear),
    }),
  );
}

const photos = new Map<string, string>();

/**
 * Reset every piece of fixture state that behaves like a server.
 *
 * Read receipts and uploaded photos outlive a single screen on purpose, which
 * means they also outlive a single test. Tests call this so one does not
 * inherit another one's payroll as already-read.
 */
export function resetFixtures(): void {
  readDeliveries.clear();
  photos.clear();
  periodCache.clear();
  figuresCache.clear();
}

export const mockApi = {
  async signIn({ email, ssnLast4, ssnFull }: { email: string; ssnLast4?: string; ssnFull?: string }): Promise<Session> {
    await latency();
    const e = email.trim().toLowerCase();

    if (!e || e.includes('unknown')) {
      throw new ApiError('INVALID_EMAIL', 'Email not recognized');
    }
    if (e.includes('shared')) {
      throw new ApiError('MULTIPLE_EMPLOYEES', 'Email shared by multiple employees', 3);
    }
    // Full-SSN escalation: the last 4 still have to match.
    const last4 = ssnFull ? ssnFull.slice(-4) : ssnLast4;
    if (ssnFull && ssnFull.replace(/\D/g, '').length !== 9) {
      throw new ApiError('INVALID_SSN', 'A Social Security number has 9 digits');
    }
    if (!last4 || last4 === '0000') {
      throw new ApiError('INVALID_SSN', 'SSN mismatch');
    }

    const solo = e.includes('solo');
    return {
      employee: { id: 'E-88214', fullName: 'MITCHELL, SARAH', firstName: 'Sarah' },
      companies: solo ? [COMPANIES[0]] : COMPANIES,
    };
  },

  /** Fixtures keep no sign-in to end. */
  async signOut(): Promise<void> {},

  async getLatestPaycheck({ employeeId }: { employeeId: string }): Promise<Paycheck> {
    await latency();
    const [latest] = periodsFor(employeeId, CURRENT_YEAR);
    if (!latest) throw new ApiError('NOT_FOUND', 'No payroll on file');
    return summarise(employeeId, latest);
  },

  async getPayYears(): Promise<number[]> {
    await latency();
    return YEARS;
  },

  async getPaychecks({ employeeId, year }: { employeeId: string; year: number }): Promise<Paycheck[]> {
    await latency();
    return periodsFor(employeeId, year).map((period) => summarise(employeeId, period));
  },

  async getStub({ paycheckId }: { companyId: string; paycheckId: string }): Promise<StubDetail> {
    await latency();
    const parsed = parseCheckId(paycheckId);
    if (!parsed) throw new ApiError('NOT_FOUND', 'Unknown pay stub');
    return buildStub(parsed.employeeId, parsed.iso, parsed.kind);
  },

  async getChecksForDate({ employeeId, payDateIso }: { employeeId: string; payDateIso: string }): Promise<Paycheck[]> {
    await latency();
    const period = periodAt(employeeId, payDateIso);
    if (!period) throw new ApiError('NOT_FOUND', 'No payroll on that date');

    return period.kinds.map((kind) => {
      const f = figuresFor(employeeId, payDateIso, kind);
      return {
        id: checkId(employeeId, payDateIso, kind),
        payDate: fmt(payDateIso),
        payDateIso,
        net: f.net,
        method: methodFor(kind),
        isNew: false,
        checkCount: 1,
        isCombined: false,
      };
    });
  },

  async getCombinedStub({ employeeId, payDateIso }: { employeeId: string; payDateIso: string }): Promise<StubDetail> {
    await latency();
    const period = periodAt(employeeId, payDateIso);
    if (!period) throw new ApiError('NOT_FOUND', 'No payroll on that date');
    return buildCombinedStub(employeeId, period);
  },

  async markPaycheckRead({ sentId }: { sentId: string }): Promise<void> {
    await delay(150);
    // Validate rather than accept anything string-shaped: a screen that passes
    // a pay-period id where a delivery id belongs should fail here, in a test,
    // not silently against the real payroll service.
    assertDeliveryId(sentId);
    readDeliveries.add(sentId);
  },

  async emailStub({ sentId }: { sentId: string }): Promise<void> {
    await latency();
    assertDeliveryId(sentId);
  },

  async getTaxDocuments({ employeeId }: { employeeId: string }): Promise<TaxDocument[]> {
    await latency();
    return taxDocumentsFor(employeeId);
  },

  async getW2({ employeeId, documentId }: { employeeId: string; documentId: string }): Promise<W2> {
    await latency();
    const match = W2_ID.exec(documentId);
    const taxYear = Number(match?.[1]);
    // Another employee's form, or one not yet issued, simply isn't there.
    if (!match || match[2] !== employeeId || !YEARS.includes(taxYear) || !w2Issued(taxYear)) {
      throw new ApiError('NOT_FOUND', 'No W-2 on file');
    }
    return buildW2(employeeId, taxYear);
  },

  async getPhoto({ employeeId }: { employeeId: string }): Promise<string | null> {
    await delay(200);
    return photos.get(employeeId) ?? null;
  },

  async uploadPhoto({ employeeId, base64 }: { employeeId: string; base64: string }): Promise<void> {
    await latency();
    photos.set(employeeId, `data:image/jpeg;base64,${base64}`);
  },
};
