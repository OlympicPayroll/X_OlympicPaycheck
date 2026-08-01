import { ApiError, type LineItem, type Paycheck, type Session, type StubDetail, type YtdTotals } from '@/api/types';

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
 * Everything one check pays and withholds.
 *
 * `net` is derived last, so gross − taxes − deductions is exact by construction.
 */
function figuresFor(employeeId: string, iso: string, kind: CheckKind): Figures {
  const r = seeded(`${employeeId}|${iso}|${kind}`);

  const earnings: LineItem[] =
    kind === 'bonus'
      ? [{ label: 'Bonus', amount: money(250 + r * 500) }]
      : [
          {
            label: 'Regular',
            detail: `${REGULAR_HOURS.toFixed(2)} hrs · $${HOURLY_RATE.toFixed(2)}/hr`,
            amount: money(REGULAR_HOURS * HOURLY_RATE),
          },
          ...(r > 0
            ? [
                {
                  label: 'Overtime',
                  detail: `${(r * 6).toFixed(2)} hrs · $${(HOURLY_RATE * 1.5).toFixed(2)}/hr`,
                  amount: money(r * 6 * HOURLY_RATE * 1.5),
                },
              ]
            : []),
        ];

  const gross = sum(earnings);

  const taxes: LineItem[] = [
    { label: 'Federal income', amount: money(gross * 0.1222) },
    { label: 'Social Security', amount: money(gross * 0.062) },
    { label: 'Medicare', amount: money(gross * 0.0145) },
    { label: 'State income', amount: money(gross * 0.0485) },
  ];

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

  return {
    earnings,
    taxes,
    deductions,
    gross,
    taxTotal,
    deductionTotal,
    net: money(gross - taxTotal - deductionTotal),
  };
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

  return {
    id: `${checkId(employeeId, period.iso, 'regular')}-combined`,
    payDate: fmt(period.iso),
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

/** The list-row summary for a whole pay period (all its checks together). */
function summarise(employeeId: string, period: Period): Paycheck {
  const net = money(
    period.kinds.reduce((total, kind) => total + figuresFor(employeeId, period.iso, kind).net, 0),
  );
  return {
    id: checkId(employeeId, period.iso, period.kinds[0]),
    payDate: fmt(period.iso),
    payDateIso: period.iso,
    net,
    method: 'Direct deposit',
    isNew: period.index === 0,
    checkCount: period.kinds.length,
    isCombined: period.combined,
    sentId: period.index === 0 ? `S-${period.iso.replace(/-/g, '')}` : undefined,
  };
}

const photos = new Map<string, string>();

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
        method: kind === 'bonus' ? 'Paper check' : 'Direct deposit',
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

  async markPaycheckRead(): Promise<void> {
    await delay(150);
  },

  async emailStub(): Promise<void> {
    await latency();
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
