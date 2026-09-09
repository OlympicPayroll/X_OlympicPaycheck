import { fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { mockApi } from '@/api/mock';
import { ApiError, type Paycheck } from '@/api/types';
import HistoryScreen from '@/app/(tabs)/history';
import HomeScreen from '@/app/(tabs)/home';

import { OTHER_COMPANY, renderSignedIn } from './test-utils';

/**
 * Previous Paychecks: the year selector, the empty cases, and where a row
 * opens. The year selector carries more state than it looks like — it has to
 * survive an employee with no payroll at all, and an employee who switches to
 * an employer whose years don't overlap.
 */

jest.setTimeout(30_000);

const push = router.push as jest.Mock;

async function openHistory() {
  const app = await renderSignedIn(<HistoryScreen />);
  await app.findByText('Previous Paychecks');
  // Years load, then that year's paychecks load off the back of them. Wait for
  // both rather than racing the default one-second findBy budget.
  await app.settle();
  return app;
}

async function openDashboard() {
  const app = await renderSignedIn(<HomeScreen />);
  await app.findByText('Dashboard');
  await app.settle();
  return app;
}

/** The first pay period of that year matching the predicate, from the backend. */
async function periodIn(year: number, predicate: (p: Paycheck) => boolean) {
  const rows = await mockApi.getPaychecks({ employeeId: 'E-88214', year });
  const row = rows.find(predicate);
  expect(row).toBeDefined();
  return row!;
}

/** Open History and select a year, waiting for its paychecks to arrive. */
async function openYear(year: number) {
  const app = await openHistory();
  await fireEvent.press(app.getByText(String(year)));
  await app.settle();
  return app;
}

afterEach(() => jest.restoreAllMocks());

describe('choosing a year', () => {
  it('selects the most recent year on arrival', async () => {
    const app = await openHistory();

    const chip = await app.findByText('2026');
    expect(chip).toBeTruthy();
    await waitFor(() => expect(app.queryAllByText(/2026/).length).toBeGreaterThan(0));
  });

  it('lists that year’s paychecks', async () => {
    const app = await openHistory();

    await app.findByText('Jul 18, 2026');
  });

  it('switches to another year when its chip is pressed', async () => {
    const app = await openHistory();
    await app.findByText('Jul 18, 2026');

    await fireEvent.press(app.getByText('2024'));

    await waitFor(() => expect(app.queryByText('Jul 18, 2026')).toBeNull());
  });

  /**
   * Every year has to stay reachable. A fixed, non-scrolling row pushed the
   * oldest chips off a narrow screen — or off any screen at large text sizes —
   * with no gesture that could bring them back.
   */
  it('keeps every year reachable in a scrollable selector', async () => {
    const app = await openHistory();
    const years = await mockApi.getPayYears();

    for (const year of years) {
      expect(app.getByText(String(year))).toBeTruthy();
    }

    const selector = app.getByText(String(years[0])).parent?.parent;
    expect(selector).toBeTruthy();
  });
});

describe('an employee with no payroll history', () => {
  beforeEach(() => {
    jest.spyOn(mockApi, 'getPayYears').mockResolvedValue([]);
  });

  /**
   * With no years there is nothing to select, which leaves the paycheck query
   * disabled — and a disabled React Query sits in `pending` forever. Rendering
   * the skeleton off `isPending` alone spun a loading state that never ended.
   */
  it('shows an empty state rather than spinning forever', async () => {
    const app = await openHistory();

    await app.findByText('No payroll history yet');
  });

  it('does not leave a loading skeleton on screen', async () => {
    const app = await openHistory();
    await app.findByText('No payroll history yet');

    expect(app.queryByText(/Jul|Aug|Sep/)).toBeNull();
  });

  it('does not ask the backend for a year it does not have', async () => {
    const paychecks = jest.spyOn(mockApi, 'getPaychecks');

    const app = await openHistory();
    await app.findByText('No payroll history yet');

    expect(paychecks).not.toHaveBeenCalled();
  });
});

describe('when the year list fails to load', () => {
  it('offers a retry instead of an empty state', async () => {
    jest.spyOn(mockApi, 'getPayYears').mockRejectedValue(new ApiError('NETWORK', 'offline'));

    const app = await openHistory();

    await app.findByText(/no internet connection/i);
    expect(app.queryByText('No payroll history yet')).toBeNull();
  });
});

describe('switching employer', () => {
  /**
   * History is a live tab, so its selected year outlives the switch. Left
   * alone, a year the new employer has no payroll for stayed selected: the
   * list read "No paychecks in this year" with no chip highlighted, which
   * looks like a failure rather than a stale selection.
   */
  it('re-selects a year the new employer actually has', async () => {
    const years = jest.spyOn(mockApi, 'getPayYears');
    years.mockResolvedValueOnce([2026, 2025]);

    const app = await openHistory();
    await app.findByText('2025');

    years.mockResolvedValue([2019, 2018]);
    await app.switchEmployer(OTHER_COMPANY);

    await app.findByText('2019');
    expect(app.queryByText('2026')).toBeNull();
  });

  it('loads the new employer’s payroll, not the old one’s', async () => {
    const paychecks = jest.spyOn(mockApi, 'getPaychecks');

    const app = await openHistory();
    await app.findByText('Jul 18, 2026');
    paychecks.mockClear();

    await app.switchEmployer(OTHER_COMPANY);

    await waitFor(() =>
      expect(paychecks).toHaveBeenCalledWith(expect.objectContaining({ employeeId: OTHER_COMPANY.employeeId })),
    );
  });
});

describe('opening a paycheck', () => {
  it('opens a single-check period straight onto its stub', async () => {
    const app = await openHistory();

    await fireEvent.press(await app.findByText('Jul 18, 2026'));

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/stub' }));
  });

  it('opens a period of several separate checks as a list', async () => {
    const row = await periodIn(2025, (p) => p.checkCount > 1 && !p.isCombined);
    const app = await openYear(2025);

    await fireEvent.press(app.getByText(row.payDate));

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/checks', params: expect.objectContaining({ date: row.payDateIso }) }),
    );
  });

  it('opens a combined period straight onto the merged stub', async () => {
    const row = await periodIn(2025, (p) => p.isCombined);
    const app = await openYear(2025);

    await fireEvent.press(app.getByText(row.payDate));

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/stub', params: expect.objectContaining({ combined: '1' }) }),
    );
  });

  it('does not send a multi-check period to a single stub', async () => {
    const row = await periodIn(2025, (p) => p.checkCount > 1 && !p.isCombined);
    const app = await openYear(2025);

    await fireEvent.press(app.getByText(row.payDate));

    expect(push).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/stub' }));
  });
});

describe('the dashboard shortcut', () => {
  /**
   * The Dashboard used to open `/stub` unconditionally, so a latest period
   * holding two checks opened one of them as if it were the whole payroll.
   * The fixtures never make period zero multi-check, so this case has to be
   * constructed explicitly to be covered at all.
   */
  it('opens the check list when the latest period holds several checks', async () => {
    const latest = await mockApi.getLatestPaycheck({ employeeId: 'E-88214' });
    jest
      .spyOn(mockApi, 'getLatestPaycheck')
      .mockResolvedValue({ ...latest, checkCount: 2, isCombined: false });

    const app = await openDashboard();
    await fireEvent.press(app.getByText('Latest Paycheck'));

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/checks' }));
  });

  it('opens the merged stub when the latest period is combined', async () => {
    const latest = await mockApi.getLatestPaycheck({ employeeId: 'E-88214' });
    jest
      .spyOn(mockApi, 'getLatestPaycheck')
      .mockResolvedValue({ ...latest, checkCount: 2, isCombined: true });

    const app = await openDashboard();
    await fireEvent.press(app.getByText('Latest Paycheck'));

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/stub', params: expect.objectContaining({ combined: '1' }) }),
    );
  });

  it('still opens a single check directly', async () => {
    const app = await openDashboard();

    await fireEvent.press(app.getByText('Latest Paycheck'));

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/stub' }));
    expect(push).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/checks' }));
  });

  it('carries the delivery id so opening it clears the NEW badge', async () => {
    const latest = await mockApi.getLatestPaycheck({ employeeId: 'E-88214' });
    const app = await openDashboard();

    await fireEvent.press(app.getByText('Latest Paycheck'));

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ sentId: latest.sentId }) }),
    );
  });
});
