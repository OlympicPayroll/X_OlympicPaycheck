import { getApi } from '@/api/client';
import type { LineItem, StubDetail, TaxDocument } from '@/api/types';

/**
 * Contract tests for annual tax documents.
 *
 * A W-2 is a year of pay stubs added up, and the first thing an employee or
 * their accountant does is check one against the other. So every box here is
 * checked against the stubs the same backend serves: a W-2 that disagrees with
 * the employee's own pay stubs fails.
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

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function documents(): Promise<TaxDocument[]> {
  return call(api.getTaxDocuments({ employeeId: EMPLOYEE }));
}

async function documentFor(year: number): Promise<TaxDocument> {
  const found = (await documents()).find((doc) => doc.taxYear === year);
  expect(found).toBeDefined();
  return found!;
}

async function w2For(year: number) {
  const doc = await documentFor(year);
  return call(api.getW2({ employeeId: EMPLOYEE, documentId: doc.id }));
}

/** Every stub paid in a year: single checks, and each check of a multi-check period. */
async function stubsFor(year: number): Promise<StubDetail[]> {
  const periods = await call(api.getPaychecks({ employeeId: EMPLOYEE, year }));
  const stubs: StubDetail[] = [];
  for (const period of periods) {
    const checks =
      period.checkCount > 1
        ? await call(api.getChecksForDate({ employeeId: EMPLOYEE, payDateIso: period.payDateIso }))
        : [period];
    for (const check of checks) {
      stubs.push(await call(api.getStub({ companyId: COMPANY, paycheckId: check.id })));
    }
  }
  return stubs;
}

/** A year's total of the stub lines a predicate picks out. */
function yearly(stubs: StubDetail[], lines: (stub: StubDetail) => LineItem[], label: (text: string) => boolean) {
  return stubs.reduce((total, stub) => total + lines(stub).filter((line) => label(line.label)).reduce((n, l) => n + l.amount, 0), 0);
}

const grossOf = (stubs: StubDetail[]) => stubs.reduce((total, stub) => total + stub.gross, 0);
const taxOf = (stubs: StubDetail[], name: string) => yearly(stubs, (s) => s.taxes, (l) => l === name);
const deferralsOf = (stubs: StubDetail[]) => yearly(stubs, (s) => s.deductions, (l) => l.startsWith('401(k)'));

describe('the list of tax documents', () => {
  it('has a W-2 for every payroll year, newest first', async () => {
    const years = (await documents()).map((doc) => doc.taxYear);
    expect(years).toEqual([2026, 2025, 2024, 2023]);
    expect((await documents()).every((doc) => doc.form === 'W-2')).toBe(true);
  });

  /** A year's W-2 cannot exist until the year is over. */
  it('shows the current year as pending and closed years as issued', async () => {
    const byYear = Object.fromEntries((await documents()).map((doc) => [doc.taxYear, doc.status]));
    expect(byYear).toEqual({ 2026: 'pending', 2025: 'available', 2024: 'available', 2023: 'available' });
  });

  it('dates each form by the January 31 deadline, moved off a weekend', async () => {
    expect((await documentFor(2024)).date).toBe('Jan 31, 2025');
    // January 31, 2026 was a Saturday, and January 31, 2027 is a Sunday.
    expect((await documentFor(2025)).date).toBe('Feb 2, 2026');
    expect((await documentFor(2026)).date).toBe('Feb 1, 2027');
  });

  it('names the employer each form comes from', async () => {
    expect((await documentFor(2025)).employerName).toBe('Cascade Coffee Roasters');
  });

  it('keeps each employer’s W-2s separate', async () => {
    const other = await call(api.getTaxDocuments({ employeeId: 'E-90551' }));
    const mine = await documents();
    expect(other[0].employerName).toBe('Northgate Catering Co.');
    expect(other.map((doc) => doc.id)).not.toContain(mine[0].id);
  });
});

describe('a W-2 adds up to the year’s pay stubs', () => {
  it('box 1: wages less 401(k) deferrals', async () => {
    const [w2, stubs] = [await w2For(2025), await stubsFor(2025)];
    expect(w2.wages).toBeCloseTo(grossOf(stubs) - deferralsOf(stubs), 2);
  });

  it('box 2: federal income tax withheld', async () => {
    const [w2, stubs] = [await w2For(2025), await stubsFor(2025)];
    expect(w2.federalIncomeTax).toBeCloseTo(taxOf(stubs, 'Federal income'), 2);
  });

  /** 401(k) deferrals escape income tax but not Social Security or Medicare. */
  it('boxes 3 and 5: every dollar of wages, deferrals included', async () => {
    const [w2, stubs] = [await w2For(2025), await stubsFor(2025)];
    expect(w2.socialSecurityWages).toBeCloseTo(grossOf(stubs), 2);
    expect(w2.medicareWages).toBeCloseTo(grossOf(stubs), 2);
    expect(w2.socialSecurityWages).toBeGreaterThan(w2.wages);
  });

  it('boxes 4 and 6: Social Security and Medicare withheld', async () => {
    const [w2, stubs] = [await w2For(2025), await stubsFor(2025)];
    expect(w2.socialSecurityTax).toBeCloseTo(taxOf(stubs, 'Social Security'), 2);
    expect(w2.medicareTax).toBeCloseTo(taxOf(stubs, 'Medicare'), 2);
  });

  it('box 12 code D: the 401(k) deferrals, with box 13 “retirement plan” checked', async () => {
    const [w2, stubs] = [await w2For(2025), await stubsFor(2025)];
    expect(w2.box12).toEqual([{ code: 'D', amount: expect.any(Number) }]);
    expect(w2.box12[0].amount).toBeCloseTo(deferralsOf(stubs), 2);
    expect(w2.retirementPlan).toBe(true);
    expect(w2.statutoryEmployee).toBe(false);
  });

  it('box 14: New Jersey’s employee contributions, labelled as NJ W-2s print them', async () => {
    const [w2, stubs] = [await w2For(2025), await stubsFor(2025)];
    const other = Object.fromEntries(w2.box14.map((line) => [line.label, line.amount]));

    expect(Object.keys(other)).toEqual(['UI/WF/SWF', 'DI', 'FLI']);
    expect(other['UI/WF/SWF']).toBeCloseTo(taxOf(stubs, 'NJ UI/WF/SWF'), 2);
    expect(other.DI).toBeCloseTo(taxOf(stubs, 'NJ DI'), 2);
    expect(other.FLI).toBeCloseTo(taxOf(stubs, 'NJ FLI'), 2);
  });

  /** The year's wages pass the $43,300 base, so UI/WF/SWF tops out at 0.425% of it. */
  it('stops NJ unemployment at the year’s wage base', async () => {
    const w2 = await w2For(2025);
    const ui = w2.box14.find((line) => line.label === 'UI/WF/SWF');
    expect(w2.socialSecurityWages).toBeGreaterThan(43_300);
    expect(ui?.amount).toBeCloseTo(43_300 * 0.00425, 1);
  });

  it('leaves NJ disability out of a year its employee rate was zero', async () => {
    const w2 = await w2For(2024);
    expect(w2.box14.map((line) => line.label)).toEqual(['UI/WF/SWF', 'FLI']);
  });

  it('boxes 15 to 17: New Jersey wages and income tax', async () => {
    const [w2, stubs] = [await w2For(2025), await stubsFor(2025)];
    expect(w2.states).toHaveLength(1);
    const [nj] = w2.states;
    expect(nj.state).toBe('NJ');
    expect(nj.wages).toBeCloseTo(w2.wages, 2);
    expect(nj.incomeTax).toBeCloseTo(taxOf(stubs, 'State income'), 2);
  });
});

describe('what a W-2 reveals', () => {
  /** The IRS allows a truncated SSN on employee copies, and the app never needs more. */
  it('carries only the last four digits of the Social Security number', async () => {
    const w2 = await w2For(2025);
    expect(w2.employee.ssnMasked).toMatch(/^XXX-XX-\d{4}$/);
    expect(JSON.stringify(w2)).not.toMatch(/\b\d{3}-?\d{2}-?\d{4}\b/);
  });

  it('identifies the employer by name, address and EIN', async () => {
    const w2 = await w2For(2025);
    expect(w2.employer.name).toBe('Cascade Coffee Roasters');
    expect(w2.employer.ein).toMatch(/^\d{2}-\d{7}$/);
    expect(w2.employer.address.length).toBeGreaterThan(0);
  });
});

describe('which W-2s can be fetched', () => {
  it('refuses the current year, which has not been issued', async () => {
    const pending = await documentFor(2026);
    await expect(call(api.getW2({ employeeId: EMPLOYEE, documentId: pending.id }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses another employee’s W-2', async () => {
    const mine = await documentFor(2025);
    await expect(call(api.getW2({ employeeId: 'E-90551', documentId: mine.id }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an id it did not issue', async () => {
    await expect(call(api.getW2({ employeeId: EMPLOYEE, documentId: 'W2-1999-E-88214' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(call(api.getW2({ employeeId: EMPLOYEE, documentId: 'not-a-form' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
