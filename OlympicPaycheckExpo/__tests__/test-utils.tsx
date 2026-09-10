import { notifyManager, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import type { Company, Session } from '@/api/types';
import { DialogProvider } from '@/lib/dialog';
import { SessionProvider, useSession } from '@/lib/session';

/**
 * Deliver cache notifications synchronously.
 *
 * React Query normally batches them onto a `setTimeout(…, 0)`, which in a test
 * means a query can settle *after* the assertions finish and re-render the
 * screen outside anyone's `act()` scope — the source of the "update was not
 * wrapped in act(...)" warnings. Warnings like that are worth removing rather
 * than tolerating: they mean the test stopped watching before the app stopped
 * working, so the next real async bug hides in the same noise.
 */
notifyManager.setScheduler((callback) => callback());

/**
 * Query clients created by `renderSignedIn`, so a test cannot end with work
 * still outstanding.
 *
 * The fixture backend answers in 350–700ms, and a screen keeps queries running
 * that its assertions never mention — the header's profile photo, a refetch
 * kicked off by the last interaction. Left alone, those land after the test
 * body returns and re-render outside any `act()` scope, producing intermittent
 * warnings that mask genuine ones.
 */
const clients = new Set<QueryClient>();

afterEach(async () => {
  for (const client of clients) {
    if (client.isFetching()) {
      await waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 10_000 });
    }
  }
  clients.clear();
});

/** iPhone-shaped insets, so safe-area consumers lay out realistically. */
const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * The same provider stack as `src/app/_layout.tsx`, minus the navigator —
 * screens under test should see the context they see in the real app.
 *
 * Retries are off: a test asserting an error state shouldn't wait out a retry.
 * `gcTime` is zeroed on both caches — the default five-minute collection timer
 * keeps the Node event loop alive and stops Jest exiting after the run.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { retry: false, gcTime: 0 },
        },
      }),
  );

  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <DialogProvider>{children}</DialogProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * Renders a screen inside the app's providers.
 *
 * Note: React Native Testing Library v14 is promise-based throughout —
 * `render`, `act`, `fireEvent` and `unmount` all have to be awaited.
 */
export function renderApp(ui: ReactElement) {
  return render(ui, { wrapper: AppProviders });
}

/** The signed-in employee the payroll fixtures are built around. */
export const SESSION: Session = {
  employee: { id: 'E-88214', fullName: 'MITCHELL, SARAH', firstName: 'Sarah' },
  companies: [{ id: 'CA-1041', employeeId: 'E-88214', name: 'Cascade Coffee Roasters', latestPayrollId: 'PR-1' }],
};

/** A second employer, for testing what happens when the employee switches. */
export const OTHER_COMPANY: Company = {
  id: 'CA-2277',
  employeeId: 'E-31009',
  name: 'Rainier Freight',
  latestPayrollId: 'PR-9',
};

/**
 * Signs in, then mounts the screen.
 *
 * Holding the children back until a company is selected means the screen's
 * queries see an employee id on their very first render, the way they do in
 * the app after the login screen navigates.
 */
function StartSession({ session, children }: { session: Session; children: ReactNode }) {
  const { startSession, company } = useSession();

  useEffect(() => {
    startSession(session);
  }, [session, startSession]);

  return company ? <>{children}</> : null;
}

/**
 * Renders a screen as a signed-in employee viewing one employer's payroll.
 *
 * Returns a `switchEmployer` so a test can do what the Profile screen's
 * "Switch employer" row does, which is the only way to reach the stale-year
 * and re-scoped-query paths.
 */
export async function renderSignedIn(ui: ReactElement, session: Session = SESSION) {
  let switchTo: ((company: Company) => void) | undefined;
  let client: QueryClient | undefined;

  function Capture({ children }: { children: ReactNode }) {
    const { selectCompany } = useSession();
    switchTo = selectCompany;
    client = useQueryClient();
    clients.add(client);
    return <>{children}</>;
  }

  const view = await render(
    <AppProviders>
      <StartSession session={session}>
        <Capture>{ui}</Capture>
      </StartSession>
    </AppProviders>,
  );

  /**
   * Wait until nothing is in flight.
   *
   * Two reasons a test needs this. The fixture backend takes 350–700ms per
   * call, so a screen whose data depends on a chain of two queries can exceed
   * the default one-second `findBy` budget. And a screen's chrome runs queries
   * of its own — the header's profile photo — which would otherwise settle
   * after the assertions and re-render outside anyone's `act()` scope.
   */
  const settle = async () => {
    await waitFor(() => expect(client?.isFetching()).toBe(0), { timeout: 10_000 });
  };

  return {
    ...view,
    settle,
    /** Pass `{ settle: false }` to observe the screen while the switch is still loading. */
    switchEmployer: async (company: Company, { settle: wait = true }: { settle?: boolean } = {}) => {
      await act(async () => switchTo?.(company));
      if (wait) await settle();
    },
  };
}
