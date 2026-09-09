import { fireEvent, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

import { mockApi } from '@/api/mock';
import { ApiError } from '@/api/types';
import LoginScreen from '@/app/index';
import UnlockScreen from '@/app/unlock';
import { hasSavedCredential, saveCredential } from '@/lib/biometrics';

import { renderApp } from './test-utils';

/**
 * The biometric unlock journey.
 *
 * These cover the paths that leave an employee unable to reach their payroll
 * at all: the manual-login fallback, and recovery after a sign-in that fails
 * *after* a good biometric scan. Both were reachable in shipped code and
 * neither was covered, because the only assertions on this flow were "did
 * `router.replace` get called" rather than "where does the employee end up".
 */

jest.setTimeout(30_000);

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

const EMAIL = 'sarah@cascade.test';
const CREDENTIAL = { email: EMAIL, ssnLast4: '4821' };

const EMAIL_FIELD = 'Email address';

/** Everything the mocked keychain currently holds (see jest.setup.js). */
const keychain = () => (SecureStore as unknown as { __store: Map<string, string> }).__store;

/** A promise a test can settle when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function enrol(email = EMAIL) {
  await saveCredential({ ...CREDENTIAL, email }, { name: 'Sarah Mitchell' });
}

/** Render the unlock screen and wait for the automatic first prompt to settle. */
async function openUnlock() {
  const app = await renderApp(<UnlockScreen />);
  await waitFor(() => expect(auth.authenticateAsync).toHaveBeenCalled());
  return app;
}

afterEach(() => jest.restoreAllMocks());

describe('opening the unlock screen', () => {
  it('prompts for biometrics without being asked', async () => {
    await enrol();

    await openUnlock();

    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it('greets the employee by name before they authenticate', async () => {
    await enrol();
    // Hold the OS prompt open, then let it settle: `verify()` shares one
    // in-flight promise across callers, so abandoning it unresolved would
    // wedge every later test in this file.
    const prompt = deferred<{ success: boolean }>();
    auth.authenticateAsync.mockReturnValue(prompt.promise as never);

    const app = await renderApp(<UnlockScreen />);
    await app.findByText('Sarah Mitchell');

    prompt.resolve({ success: false });
    await waitFor(() => expect(app.queryByText('Try Again')).toBeTruthy());
  });

  it('signs in and routes onward when the scan passes', async () => {
    await enrol('solo@cascade.test');

    await openUnlock();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
  });

  it('sends multi-employer staff to the company picker', async () => {
    await enrol();

    await openUnlock();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/companies'));
  });

  it('hands over to the form when the device can no longer do biometrics', async () => {
    await enrol();
    auth.hasHardwareAsync.mockResolvedValue(false);

    await renderApp(<UnlockScreen />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });
});

describe('cancelling the biometric prompt', () => {
  beforeEach(() => {
    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' } as never);
  });

  it('stays put and offers another attempt', async () => {
    await enrol();

    const app = await openUnlock();

    await app.findByText('Try Again');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('re-prompts when Try Again is pressed', async () => {
    await enrol();
    const app = await openUnlock();

    await fireEvent.press(await app.findByText('Try Again'));

    await waitFor(() => expect(auth.authenticateAsync).toHaveBeenCalledTimes(2));
  });

  /**
   * The bug this exists to prevent: "Use email instead" navigated to `/`, the
   * login screen saw the saved credential and sent the employee straight back
   * here, and the prompt fired again. The advertised escape hatch was a loop,
   * and the only way out was erasing the enrolment.
   */
  it('escapes to the form in a way the form will honour', async () => {
    await enrol();
    const app = await openUnlock();

    await fireEvent.press(app.getByText('Use email instead'));

    expect(router.replace).toHaveBeenCalledWith({ pathname: '/', params: { manual: '1' } });
  });

  it('keeps the enrolment when falling back to the form', async () => {
    await enrol();
    const app = await openUnlock();

    await fireEvent.press(app.getByText('Use email instead'));

    await expect(hasSavedCredential()).resolves.toBe(true);
  });

  it('erases the enrolment only when asked to forget the device', async () => {
    await enrol();
    const app = await openUnlock();

    await fireEvent.press(app.getByText('Forget this device'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    await expect(hasSavedCredential()).resolves.toBe(false);
    expect(keychain().size).toBe(0);
  });
});

describe('a sign-in that fails after a good scan', () => {
  /**
   * The screen used to stay in its "prompting" state while the API call ran,
   * so a failed call left the busy flag stuck on and Try Again hidden. The
   * employee saw an error with no control that could act on it.
   */
  it('shows the failure and restores the retry control', async () => {
    await enrol();
    jest.spyOn(mockApi, 'signIn').mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));

    const app = await openUnlock();

    await app.findByText(/no internet connection/i);
    await app.findByText('Try Again');
  });

  it('does not navigate anywhere', async () => {
    await enrol();
    jest.spyOn(mockApi, 'signIn').mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));

    const app = await openUnlock();
    await app.findByText('Try Again');

    expect(router.replace).not.toHaveBeenCalled();
  });

  it('signs in on a retry once the network comes back', async () => {
    await enrol('solo@cascade.test');
    const signIn = jest.spyOn(mockApi, 'signIn');
    signIn.mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));

    const app = await openUnlock();
    await fireEvent.press(await app.findByText('Try Again'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('still lets the employee reach the form instead', async () => {
    await enrol();
    jest.spyOn(mockApi, 'signIn').mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));

    const app = await openUnlock();
    await app.findByText('Try Again');
    await fireEvent.press(app.getByText('Use email instead'));

    expect(router.replace).toHaveBeenCalledWith({ pathname: '/', params: { manual: '1' } });
  });
});

describe('an enrolment the OS will no longer open', () => {
  /**
   * iOS ties the stored item to the biometric set that existed when it was
   * written, so enrolling a new fingerprint destroys it. Retrying the scan can
   * never help, so the screen must say so rather than offering Try Again.
   */
  beforeEach(async () => {
    await enrol();
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (key === 'olympic.paycheck.credential.v2') throw new Error('key invalidated');
      const store = keychain();
      return store.has(key) ? (store.get(key) as string) : null;
    });
  });

  it('explains that the saved sign-in is gone', async () => {
    const app = await openUnlock();

    await app.findByText('Saved sign-in expired');
  });

  it('does not offer a retry that cannot work', async () => {
    const app = await openUnlock();
    await app.findByText('Saved sign-in expired');

    expect(app.queryByText('Try Again')).toBeNull();
  });

  it('still offers both ways out', async () => {
    const app = await openUnlock();
    await app.findByText('Saved sign-in expired');

    expect(app.getByText('Use email instead')).toBeTruthy();
    expect(app.getByText('Forget this device')).toBeTruthy();
  });
});

describe('the login screen after a deliberate fallback', () => {
  const { __setParams } = jest.requireMock('expo-router') as { __setParams: (p: object) => void };

  it('normally bounces an enrolled device to the unlock screen', async () => {
    await enrol();

    await renderApp(<LoginScreen />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/unlock'));
  });

  it('shows the form instead when the employee chose email', async () => {
    await enrol();
    __setParams({ manual: '1' });

    const app = await renderApp(<LoginScreen />);

    await app.findByLabelText(EMAIL_FIELD);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('leaves the enrolment intact so biometrics still work next launch', async () => {
    await enrol();
    __setParams({ manual: '1' });

    const app = await renderApp(<LoginScreen />);
    await app.findByLabelText(EMAIL_FIELD);

    await expect(hasSavedCredential()).resolves.toBe(true);
  });
});
