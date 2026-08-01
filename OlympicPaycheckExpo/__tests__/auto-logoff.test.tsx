import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';

import type { Session } from '@/api/types';
import { AutoLogoff } from '@/lib/auto-logoff';
import { SessionProvider, useSession } from '@/lib/session';

/**
 * Pay information must not sit on screen on an unattended phone. Five minutes
 * of inactivity — or five minutes spent in the background — ends the session.
 */
const IDLE_MS = 5 * 60 * 1000;

const SESSION: Session = {
  employee: { id: 'E-88214', fullName: 'MITCHELL, SARAH', firstName: 'Sarah' },
  companies: [{ id: 'CA-1041', employeeId: 'E-88214', name: 'Cascade Coffee Roasters', latestPayrollId: 'PR-1' }],
};

let appState: ((status: AppStateStatus) => void) | undefined;

function Harness({ session }: { session: Session | null }) {
  const { startSession, signedIn } = useSession();

  useEffect(() => {
    if (session) startSession(session);
  }, [session, startSession]);

  return (
    <AutoLogoff>
      <Text>{signedIn ? 'signed in' : 'signed out'}</Text>
    </AutoLogoff>
  );
}

const renderScreen = (session: Session | null = SESSION) =>
  render(
    <SessionProvider>
      <Harness session={session} />
    </SessionProvider>,
  );

/** Let timers fire and React settle. */
const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

beforeEach(() => {
  jest.useFakeTimers();
  appState = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    appState = handler as (status: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('idle timeout', () => {
  it('signs the employee out after five idle minutes', async () => {
    const app = await renderScreen();
    await wait(IDLE_MS);

    expect(app.queryByText('signed out')).not.toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('leaves the session alone just before the timeout', async () => {
    const app = await renderScreen();
    await wait(IDLE_MS - 1000);

    expect(app.queryByText('signed in')).not.toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('restarts the countdown on every touch', async () => {
    const app = await renderScreen();

    await wait(IDLE_MS - 60_000);
    // A touch anywhere resets it — the handler is capture-phase, so it sees
    // the touch without stopping the button underneath from working.
    await fireEvent(app.getByText('signed in'), 'startShouldSetResponderCapture');
    await wait(IDLE_MS - 60_000);

    expect(app.queryByText('signed in')).not.toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does eventually fire after the touch', async () => {
    const app = await renderScreen();

    await fireEvent(app.getByText('signed in'), 'startShouldSetResponderCapture');
    await wait(IDLE_MS);

    expect(app.queryByText('signed out')).not.toBeNull();
  });

  it('runs no timer when nobody is signed in', async () => {
    await renderScreen(null);
    await wait(IDLE_MS * 2);

    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('time spent in the background', () => {
  it('counts toward the timeout', async () => {
    const app = await renderScreen();

    await act(async () => appState?.('background'));
    await wait(IDLE_MS + 1000);
    await act(async () => appState?.('active'));

    expect(app.queryByText('signed out')).not.toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('keeps the session through a brief interruption', async () => {
    const app = await renderScreen();

    await act(async () => appState?.('background'));
    await wait(30_000);
    await act(async () => appState?.('active'));

    expect(app.queryByText('signed in')).not.toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('gives a full five minutes again after coming back', async () => {
    const app = await renderScreen();

    await act(async () => appState?.('background'));
    await wait(60_000);
    await act(async () => appState?.('active'));
    await wait(IDLE_MS - 1000);

    expect(app.queryByText('signed in')).not.toBeNull();
  });

  /** iOS shows 'inactive' when the app switcher or a call banner appears. */
  it('treats an inactive phase like the background', async () => {
    const app = await renderScreen();

    await act(async () => appState?.('inactive'));
    await wait(IDLE_MS + 1000);
    await act(async () => appState?.('active'));

    expect(app.queryByText('signed out')).not.toBeNull();
  });

  it('ignores app-state changes when signed out', async () => {
    await renderScreen(null);

    await act(async () => appState?.('background'));
    await wait(IDLE_MS * 2);
    await act(async () => appState?.('active'));

    expect(router.replace).not.toHaveBeenCalled();
  });
});
