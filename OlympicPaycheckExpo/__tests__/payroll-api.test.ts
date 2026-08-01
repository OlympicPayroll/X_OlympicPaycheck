import { getApi } from '@/api/client';
import { ApiError, type StubDetail } from '@/api/types';

/**
 * Contract tests for the payroll backend.
 *
 * These run against whatever `getApi()` returns, so when the real Olympic
 * Payroll API is wired in they become the acceptance suite for it — every
 * invariant here is one an employee can verify by reading their own stub.
 */

const api = getApi();
const EMPLOYEE = 'E-88214';
const COMPANY = 'CA-1041';

/** The backend simulates latency; fake timers skip the wait. */
async function call<T>(pending: Promise<T>): Promise<T> {
  const settled = pending.then(
    (value) => ({ ok: true, value }) as const,
    (error) => ({ ok: false, error }) as const,
  );
  await jest.advanceTimersByTimeAsync(2000);
  const outcome = await settled;
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

const total = (items: { amount: number }[]) => items.reduce((n, i) => n + i.amount, 0);

/** Every rule a pay stub must satisfy to be believable to the person paid. */
function expectInternallyConsistent(stub: StubDetail) {
  expect(total(stub.earnings)).toBeCloseTo(stub.gross, 2);
  expect(total(stub.taxes)).toBeCloseTo(stub.taxTotal, 2);
  expect(total(stub.deductions)).toBeCloseTo(stub.deductionTotal, 2);
  expect(stub.gross - stub.taxTotal - stub.deductionTotal).toBeCloseTo(stub.net, 2);

  expect(stub.gross).toBeGreaterThan(0);
  expect(stub.net).toBeGreaterThan(0);
  expect(stub.net).toBeLessThan(stub.gross);
  expect(stub.ytd.gross - stub.ytd.taxes - stub.ytd.deductions).toBeCloseTo(stub.ytd.net, 2);
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('signIn', () => {
  it('returns the employee and their companies', async () => {
    const session = await call(api.signIn({ email: 'sarah@cascade.test', ssnLast4: '4821' }));
    expect(session.employee.fullName).toBe('MITCHELL, SARAH');
    expect(session.companies.length).toBeGreaterThan(1);
  });

  it('gives every company its own employee id', async () => {
    const session = await call(api.signIn({ email: 'sarah@cascade.test', ssnLast4: '4821' }));
    const ids = session.companies.map((c) => c.employeeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns a single company for a single-employer account', async () => {
    const session = await call(api.signIn({ email: 'solo@cascade.test', ssnLast4: '4821' }));
    expect(session.companies).toHaveLength(1);
  });

  it('rejects an unrecognised email', async () => {
    await expect(call(api.signIn({ email: 'unknown@nowhere.test', ssnLast4: '4821' }))).rejects.toMatchObject({
      code: 'INVALID_EMAIL',
    });
  });

  it('rejects an empty email', async () => {
    await expect(call(api.signIn({ email: '   ', ssnLast4: '4821' }))).rejects.toMatchObject({
      code: 'INVALID_EMAIL',
    });
  });

  it('rejects a mismatched SSN', async () => {
    await expect(call(api.signIn({ email: 'sarah@cascade.test', ssnLast4: '0000' }))).rejects.toMatchObject({
      code: 'INVALID_SSN',
    });
  });

  it('reports how many employees share a duplicated email', async () => {
    await expect(call(api.signIn({ email: 'shared@cascade.test', ssnLast4: '4821' }))).rejects.toMatchObject({
      code: 'MULTIPLE_EMPLOYEES',
      count: 3,
    });
  });

  describe('full-SSN escalation', () => {
    it('accepts nine digits whose last four match', async () => {
      const session = await call(api.signIn({ email: 'sarah@cascade.test', ssnFull: '123456789' }));
      expect(session.employee.id).toBe(EMPLOYEE);
    });

    it('rejects a short SSN', async () => {
      await expect(call(api.signIn({ email: 'sarah@cascade.test', ssnFull: '12345' }))).rejects.toMatchObject({
        code: 'INVALID_SSN',
      });
    });

    it('still checks the last four digits', async () => {
      await expect(call(api.signIn({ email: 'sarah@cascade.test', ssnFull: '123450000' }))).rejects.toMatchObject({
        code: 'INVALID_SSN',
      });
    });
  });
});

describe('pay history', () => {
  it('lists years newest first', async () => {
    const years = await call(api.getPayYears({ employeeId: EMPLOYEE }));
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });

  it('lists a year’s pay periods newest first', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2026 }));
    const dates = paychecks.map((p) => p.payDateIso);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('flags exactly one payroll as unread, in the current year', async () => {
    const [current, previous] = await Promise.all([
      call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2026 })),
      call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 })),
    ]);
    expect(current.filter((p) => p.isNew)).toHaveLength(1);
    expect(previous.filter((p) => p.isNew)).toHaveLength(0);
  });

  it('carries a sentId on the unread payroll so it can be marked read', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2026 }));
    const unread = paychecks.find((p) => p.isNew);
    expect(unread?.sentId).toBeTruthy();
  });

  it('matches the latest paycheck to the first row of the current year', async () => {
    const [latest, paychecks] = await Promise.all([
      call(api.getLatestPaycheck({ employeeId: EMPLOYEE })),
      call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2026 })),
    ]);
    expect(latest).toEqual(paychecks[0]);
  });

  it('returns the same figures on repeated calls', async () => {
    const first = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2024 }));
    const second = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2024 }));
    expect(first).toEqual(second);
  });

  it('gives different employees different pay', async () => {
    const [a, b] = await Promise.all([
      call(api.getPaychecks({ employeeId: 'E-88214', year: 2025 })),
      call(api.getPaychecks({ employeeId: 'E-90551', year: 2025 })),
    ]);
    expect(a[0].net).not.toBe(b[0].net);
  });
});

describe('pay stub', () => {
  it('adds up, on every period of a year', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }));
    const singles = paychecks.filter((p) => p.checkCount === 1);
    expect(singles.length).toBeGreaterThan(5);

    for (const paycheck of singles) {
      const stub = await call(api.getStub({ companyId: COMPANY, paycheckId: paycheck.id }));
      expectInternallyConsistent(stub);
    }
  });

  /** The bug this pins: the list row and the stub it opens must agree. */
  it('shows the same net pay as the row that opened it', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }));

    for (const paycheck of paychecks.filter((p) => p.checkCount === 1)) {
      const stub = await call(api.getStub({ companyId: COMPANY, paycheckId: paycheck.id }));
      expect(stub.net).toBe(paycheck.net);
      expect(stub.payDate).toBe(paycheck.payDate);
    }
  });

  it('itemises hours and rate on regular earnings', async () => {
    const [paycheck] = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2026 }));
    const stub = await call(api.getStub({ companyId: COMPANY, paycheckId: paycheck.id }));
    const regular = stub.earnings.find((e) => e.label === 'Regular');
    expect(regular?.detail).toMatch(/hrs · \$\d+\.\d{2}\/hr/);
  });

  it('withholds the four expected taxes', async () => {
    const [paycheck] = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2026 }));
    const stub = await call(api.getStub({ companyId: COMPANY, paycheckId: paycheck.id }));
    expect(stub.taxes.map((t) => t.label)).toEqual([
      'Federal income',
      'Social Security',
      'Medicare',
      'State income',
    ]);
  });

  it('rejects an unparseable stub id rather than inventing a stub', async () => {
    await expect(call(api.getStub({ companyId: COMPANY, paycheckId: 'not-a-real-id' }))).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(call(api.getStub({ companyId: COMPANY, paycheckId: '' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('year to date', () => {
  it('starts the year at the first period’s own totals', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }));
    const oldest = paychecks[paychecks.length - 1];
    const stub = await call(api.getStub({ companyId: COMPANY, paycheckId: oldest.id }));

    expect(stub.ytd.gross).toBeCloseTo(stub.gross, 2);
    expect(stub.ytd.net).toBeCloseTo(stub.net, 2);
  });

  it('accumulates to the sum of every check in the year', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }));
    const newest = paychecks[0];
    const stub = await call(api.getStub({ companyId: COMPANY, paycheckId: newest.id }));

    const yearNet = paychecks.reduce((n, p) => n + p.net, 0);
    expect(stub.ytd.net).toBeCloseTo(yearNet, 2);
  });

  it('never decreases as the year progresses', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2024 }));
    // Oldest first, sampling a few periods to keep the test quick.
    const sample = [...paychecks].reverse().filter((_, i) => i % 5 === 0);

    let previous = 0;
    for (const paycheck of sample) {
      const stub = await call(api.getStub({ companyId: COMPANY, paycheckId: paycheck.id }));
      expect(stub.ytd.gross).toBeGreaterThan(previous);
      previous = stub.ytd.gross;
    }
  });
});

describe('multiple checks in one period', () => {
  it('exists in the fixture set', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }));
    expect(paychecks.some((p) => p.checkCount > 1)).toBe(true);
  });

  it('splits into that many checks, whose nets sum to the row total', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }));
    const period = paychecks.find((p) => p.checkCount > 1 && !p.isCombined);
    expect(period).toBeDefined();

    const checks = await call(api.getChecksForDate({ employeeId: EMPLOYEE, payDateIso: period!.payDateIso }));
    expect(checks).toHaveLength(period!.checkCount);
    expect(checks.reduce((n, c) => n + c.net, 0)).toBeCloseTo(period!.net, 2);
  });

  it('opens each individual check on its own consistent stub', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }));
    const period = paychecks.find((p) => p.checkCount > 1)!;
    const checks = await call(api.getChecksForDate({ employeeId: EMPLOYEE, payDateIso: period.payDateIso }));

    for (const check of checks) {
      const stub = await call(api.getStub({ companyId: COMPANY, paycheckId: check.id }));
      expectInternallyConsistent(stub);
      expect(stub.net).toBe(check.net);
    }
  });

  it('merges into a combined stub totalling the same net', async () => {
    const paychecks = await call(api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }));
    const period = paychecks.find((p) => p.checkCount > 1)!;

    const combined = await call(api.getCombinedStub({ employeeId: EMPLOYEE, payDateIso: period.payDateIso }));
    expectInternallyConsistent(combined);
    expect(combined.net).toBeCloseTo(period.net, 2);
  });

  it('reports no payroll on a date the employee wasn’t paid', async () => {
    await expect(
      call(api.getChecksForDate({ employeeId: EMPLOYEE, payDateIso: '2025-01-01' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('profile photo', () => {
  it('has none until one is uploaded', async () => {
    expect(await call(api.getPhoto({ employeeId: 'E-NEW-HIRE' }))).toBeNull();
  });

  it('round-trips an upload as a displayable data URI', async () => {
    await call(api.uploadPhoto({ employeeId: 'E-PHOTO', base64: 'QUJD' }));
    const uri = await call(api.getPhoto({ employeeId: 'E-PHOTO' }));
    expect(uri).toBe('data:image/jpeg;base64,QUJD');
  });
});
