import { act, fireEvent, waitFor } from '@testing-library/react-native';
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
 * On a real build the saved secret carries an OS gate, so reading it *is* the
 * biometric prompt. Here, each gated read of the secret stands in for one
 * prompt, and making that read fail with the text expo-secure-store produces
 * stands in for the employee cancelling, being locked out, and so on.
 */

jest.setTimeout(30_000);

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const replace = router.replace as jest.Mock;

const EMAIL = 'sarah@cascade.test';
const CREDENTIAL = { email: EMAIL, ssnLast4: '4821' };
const SECRET_KEY = 'olympic.paycheck.credential.v2';
const META_KEY = 'olympic.paycheck.enrollment';
const MANUAL = { pathname: '/', params: { manual: '1' } };

const EMAIL_FIELD = 'Email address';

// What expo-secure-store's native layer reports for each prompt outcome.
const CANCELLED = 'Could not Authenticate the user: User canceled the authentication. Cancel';
const LOCKED_OUT = 'Could not Authenticate the user: Lockout. Too many attempts. Try again later.';
const NO_BIOMETRICS = 'Could not Authenticate the user: No biometrics are currently enrolled';
const UNDECRYPTABLE = "Could not decrypt the value for key 'olympic.paycheck.credential.v2'. Caused by: bad data";

/** Everything the mocked keychain currently holds (see jest.setup.js). */
const keychain = () => (SecureStore as unknown as { __store: Map<string, string> }).__store;
const stored = (key: string) => keychain().get(key) ?? null;

/** A promise a test can settle when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Enrol as a real build does: the secret carries the OS gate. */
async function enrol(email = EMAIL) {
  await saveCredential({ ...CREDENTIAL, email }, { name: 'Sarah Mitchell' });
}

/** Enrol as Expo Go or an older build does: no OS gate on the secret. */
function enrolUngated(email = EMAIL) {
  keychain().set(SECRET_KEY, JSON.stringify({ ...CREDENTIAL, email }));
  keychain().set(META_KEY, JSON.stringify({ name: 'Sarah Mitchell', secured: false }));
}

/** Reads of the gated secret. On a device, each one is a biometric prompt. */
const gatedReads = () =>
  jest
    .mocked(SecureStore.getItemAsync)
    .mock.calls.filter(
      ([key, options]) =>
        key === SECRET_KEY && (options as SecureStore.SecureStoreOptions | undefined)?.requireAuthentication,
    );

/** Make the gated read fail, `times` times, the way the OS reports it. */
function failGate(message: string, times = Number.POSITIVE_INFINITY) {
  let remaining = times;
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
    if (key === SECRET_KEY && remaining > 0) {
      remaining -= 1;
      throw new Error(message);
    }
    return stored(key);
  });
}

/** Render the unlock screen and wait for its first attempt to prompt. */
async function openUnlock() {
  const app = await renderApp(<UnlockScreen />);
  await waitFor(() => expect(gatedReads().length + auth.authenticateAsync.mock.calls.length).toBeGreaterThan(0));
  return app;
}

afterEach(() => jest.restoreAllMocks());

describe('opening the unlock screen', () => {
  /**
   * The app used to run its own biometric check and then read the gated
   * secret, which prompts again: two scans for one sign-in.
   */
  it('asks for exactly one biometric scan', async () => {
    await enrol();

    await openUnlock();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/companies'));
    expect(gatedReads()).toHaveLength(1);
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  /** Without the OS gate, the app's own check is the only thing guarding the secret. */
  it('runs the app’s own check when the saved secret has no OS gate', async () => {
    enrolUngated();

    await openUnlock();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/companies'));
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it('greets the employee by name before they authenticate', async () => {
    await enrol();
    const prompt = deferred<string | null>();
    jest
      .mocked(SecureStore.getItemAsync)
      .mockImplementation(async (key) => (key === SECRET_KEY ? prompt.promise : stored(key)));

    const app = await renderApp(<UnlockScreen />);
    await app.findByText('Sarah Mitchell');
    expect(replace).not.toHaveBeenCalled();

    await act(async () => prompt.resolve(JSON.stringify(CREDENTIAL)));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/companies'));
  });

  it('signs in and routes onward when the scan passes', async () => {
    await enrol('solo@cascade.test');

    await openUnlock();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('hands over to the form when the device can no longer do biometrics', async () => {
    await enrol();
    auth.hasHardwareAsync.mockResolvedValue(false);

    await renderApp(<UnlockScreen />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(gatedReads()).toHaveLength(0);
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it('goes to the form when nothing is enrolled after all', async () => {
    await openUnlock();

    await waitFor(() => expect(replace).toHaveBeenCalledWith(MANUAL));
  });
});

describe('cancelling the prompt', () => {
  beforeEach(() => failGate(CANCELLED));

  /** Cancelling used to be reported as an expired sign-in, with no way to retry. */
  it('stays put and offers another attempt', async () => {
    await enrol();

    const app = await openUnlock();

    await app.findByText('Try Again');
    expect(app.getByText('Sign in to continue')).toBeTruthy();
    expect(app.queryByText('Saved sign-in expired')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the enrolment', async () => {
    await enrol();
    const app = await openUnlock();

    await app.findByText('Try Again');

    await expect(hasSavedCredential()).resolves.toBe(true);
  });

  it('prompts again when Try Again is pressed', async () => {
    await enrol();
    const app = await openUnlock();

    await fireEvent.press(await app.findByText('Try Again'));

    await waitFor(() => expect(gatedReads()).toHaveLength(2));
  });

  it('escapes to the form in a way the form will honour', async () => {
    await enrol();
    const app = await openUnlock();
    await app.findByText('Try Again');

    await fireEvent.press(app.getByText('Use email instead'));

    expect(replace).toHaveBeenCalledWith(MANUAL);
  });

  it('keeps the enrolment when falling back to the form', async () => {
    await enrol();
    const app = await openUnlock();
    await app.findByText('Try Again');

    await fireEvent.press(app.getByText('Use email instead'));

    await expect(hasSavedCredential()).resolves.toBe(true);
  });

  it('erases the enrolment only when asked to forget the device', async () => {
    await enrol();
    const app = await openUnlock();
    await app.findByText('Try Again');

    await fireEvent.press(app.getByText('Forget this device'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    await expect(hasSavedCredential()).resolves.toBe(false);
    expect(keychain().size).toBe(0);
  });
});

describe('cancelling the app’s own check', () => {
  it('offers another attempt without touching the secret', async () => {
    enrolUngated();
    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' } as never);

    const app = await openUnlock();

    await app.findByText('Try Again');
    expect(gatedReads()).toHaveLength(0);
  });
});

describe('other prompt outcomes', () => {
  it('explains a lockout and how to clear it', async () => {
    await enrol();
    failGate(LOCKED_OUT);

    const app = await openUnlock();

    await app.findByText('Face ID is locked');
    expect(app.getByText(/unlock it with your passcode once/i)).toBeTruthy();
    expect(app.getByText('Try Again')).toBeTruthy();
    await expect(hasSavedCredential()).resolves.toBe(true);
  });

  it('says when biometrics are unavailable', async () => {
    await enrol();
    failGate(NO_BIOMETRICS);

    const app = await openUnlock();

    await app.findByText('Face ID isn’t available');
    await expect(hasSavedCredential()).resolves.toBe(true);
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

    expect(replace).not.toHaveBeenCalled();
  });

  it('signs in on a retry once the network comes back', async () => {
    await enrol('solo@cascade.test');
    const signIn = jest.spyOn(mockApi, 'signIn');
    signIn.mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));

    const app = await openUnlock();
    await fireEvent.press(await app.findByText('Try Again'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  /** The old error used to stay above the new prompt and hide how it ended. */
  it('drops the old error once the employee tries again', async () => {
    await enrol();
    jest.spyOn(mockApi, 'signIn').mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));
    const app = await openUnlock();
    await app.findByText(/no internet connection/i);

    failGate(CANCELLED, 1);
    await fireEvent.press(app.getByText('Try Again'));

    await app.findByText('Sign in to continue');
    expect(app.queryByText('We couldn’t sign you in')).toBeNull();
    expect(app.queryByText(/no internet connection/i)).toBeNull();
  });

  it('still lets the employee reach the form instead', async () => {
    await enrol();
    jest.spyOn(mockApi, 'signIn').mockRejectedValueOnce(new ApiError('NETWORK', 'offline'));

    const app = await openUnlock();
    await app.findByText('Try Again');
    await fireEvent.press(app.getByText('Use email instead'));

    expect(replace).toHaveBeenCalledWith(MANUAL);
  });
});

describe('an enrolment the OS will no longer open', () => {
  /**
   * Android returns nothing, rather than throwing, for a key invalidated by a
   * biometric change. That used to be read as "nothing enrolled": this screen
   * sent the employee to the login form, which saw the enrolment record and
   * sent them straight back here, in a loop.
   */
  it('does not loop when the secret has silently vanished', async () => {
    await enrol();
    keychain().delete(SECRET_KEY);

    const app = await openUnlock();

    await app.findByText('Saved sign-in expired');
    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * The screen said the sign-in had been cleared, but it was left in place:
   * every later launch came back to this failure, and signing in with email
   * never offered biometrics again.
   */
  it('removes the dead enrolment so the next launch shows the form', async () => {
    await enrol();
    keychain().delete(SECRET_KEY);
    const app = await openUnlock();
    await app.findByText('Saved sign-in expired');

    await expect(hasSavedCredential()).resolves.toBe(false);

    replace.mockClear();
    const nextLaunch = await renderApp(<LoginScreen />);
    await nextLaunch.findByLabelText(EMAIL_FIELD);
    expect(replace).not.toHaveBeenCalledWith('/unlock');
  });

  it('treats a secret that cannot be decrypted the same way', async () => {
    await enrol();
    failGate(UNDECRYPTABLE);

    const app = await openUnlock();

    await app.findByText('Saved sign-in expired');
    await expect(hasSavedCredential()).resolves.toBe(false);
  });

  it('does not offer a retry that cannot work', async () => {
    await enrol();
    keychain().delete(SECRET_KEY);
    const app = await openUnlock();

    await app.findByText('Saved sign-in expired');

    expect(app.queryByText('Try Again')).toBeNull();
  });

  it('still offers a way to the form', async () => {
    await enrol();
    keychain().delete(SECRET_KEY);
    const app = await openUnlock();

    await app.findByText('Saved sign-in expired');

    expect(app.getByText('Use email instead')).toBeTruthy();
  });
});

describe('the login screen after a deliberate fallback', () => {
  const { __setParams } = jest.requireMock('expo-router') as { __setParams: (p: object) => void };

  it('normally bounces an enrolled device to the unlock screen', async () => {
    await enrol();

    await renderApp(<LoginScreen />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/unlock'));
  });

  it('shows the form instead when the employee chose email', async () => {
    await enrol();
    __setParams({ manual: '1' });

    const app = await renderApp(<LoginScreen />);

    await app.findByLabelText(EMAIL_FIELD);
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves the enrolment intact so biometrics still work next launch', async () => {
    await enrol();
    __setParams({ manual: '1' });

    const app = await renderApp(<LoginScreen />);
    await app.findByLabelText(EMAIL_FIELD);

    await expect(hasSavedCredential()).resolves.toBe(true);
  });
});
