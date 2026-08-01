import { act, renderHook } from '@testing-library/react-native';

import type { Company, Session } from '@/api/types';
import { SessionProvider, useSession } from '@/lib/session';

const CASCADE: Company = {
  id: 'CA-1041',
  employeeId: 'E-88214',
  name: 'Cascade Coffee Roasters',
  latestPayrollId: 'PR-90233',
};
const NORTHGATE: Company = {
  id: 'CA-2277',
  employeeId: 'E-90551',
  name: 'Northgate Catering Co.',
  latestPayrollId: 'PR-90240',
};

const employee = { id: 'E-88214', fullName: 'MITCHELL, SARAH', firstName: 'Sarah' };
const multiCompany: Session = { employee, companies: [CASCADE, NORTHGATE] };
const singleCompany: Session = { employee, companies: [CASCADE] };

const renderSession = () => renderHook(() => useSession(), { wrapper: SessionProvider });

describe('session', () => {
  it('starts signed out', async () => {
    const { result } = await renderSession();

    expect(result.current.signedIn).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.company).toBeNull();
  });

  it('skips the picker for a single-employer account', async () => {
    const { result } = await renderSession();
    await act(async () => result.current.startSession(singleCompany));

    expect(result.current.signedIn).toBe(true);
    expect(result.current.company).toEqual(CASCADE);
  });

  it('waits for a choice when the employee has several employers', async () => {
    const { result } = await renderSession();
    await act(async () => result.current.startSession(multiCompany));

    expect(result.current.signedIn).toBe(true);
    expect(result.current.company).toBeNull();
  });

  it('scopes payroll lookups to the chosen employer', async () => {
    const { result } = await renderSession();
    await act(async () => result.current.startSession(multiCompany));
    await act(async () => result.current.selectCompany(NORTHGATE));

    // Queries key off company.employeeId — the id *within* that employer.
    expect(result.current.company?.employeeId).toBe('E-90551');
  });

  it('lets the employee switch employers without signing out', async () => {
    const { result } = await renderSession();
    await act(async () => result.current.startSession(multiCompany));
    await act(async () => result.current.selectCompany(CASCADE));
    await act(async () => result.current.selectCompany(NORTHGATE));

    expect(result.current.signedIn).toBe(true);
    expect(result.current.company).toEqual(NORTHGATE);
  });

  it('clears everything on sign-out', async () => {
    const { result } = await renderSession();
    await act(async () => result.current.startSession(singleCompany));
    await act(async () => result.current.endSession());

    expect(result.current.signedIn).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.company).toBeNull();
  });

  it('leaves no employer selected after signing back in with several', async () => {
    const { result } = await renderSession();
    await act(async () => result.current.startSession(singleCompany));
    await act(async () => result.current.endSession());
    await act(async () => result.current.startSession(multiCompany));

    expect(result.current.company).toBeNull();
  });
});
