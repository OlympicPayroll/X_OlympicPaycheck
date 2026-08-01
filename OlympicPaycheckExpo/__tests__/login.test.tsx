import { fireEvent, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

import LoginScreen from '@/app/index';

import { renderApp } from './test-utils';

/**
 * The sign-in screen carries the app's security behaviour: the legacy
 * escalation from last-4 to the full SSN, the lockout after that, and the
 * promise that a Social Security number is never written to the device.
 */

// The fixture backend simulates network latency on every attempt.
jest.setTimeout(30_000);

const EMAIL = 'sarah@cascade.test';
const GOOD_SSN = '4821';
const BAD_SSN = '0000';

const CREDENTIAL_KEY = 'olympic.paycheck.credential';
const EMAIL_KEY = 'olympic.paycheck.rememberedEmail';

const EMAIL_FIELD = 'Email address';
const LAST4_FIELD = 'Last 4 digits of your Social Security number';
const FULL_SSN_FIELD = 'Full Social Security number';
const REMEMBER_SWITCH = 'Remember my email';

type App = Awaited<ReturnType<typeof renderApp>>;

/** Everything the mocked keychain currently holds (see jest.setup.js). */
const keychain = () => (SecureStore as unknown as { __store: Map<string, string> }).__store;

/** Renders the screen and waits out the "does this device have a saved sign-in?" check. */
async function openLogin(): Promise<App> {
  const app = await renderApp(<LoginScreen />);
  await app.findByLabelText(EMAIL_FIELD);
  return app;
}

async function submit(app: App, { email = EMAIL, ssn = GOOD_SSN } = {}) {
  await fireEvent.changeText(app.getByLabelText(EMAIL_FIELD), email);
  await fireEvent.changeText(app.getByLabelText(LAST4_FIELD), ssn);
  await fireEvent.press(app.getByText('Sign In'));
}

/** Fail the last-4 check twice, which is what triggers the escalation. */
async function escalate(app: App) {
  await submit(app, { ssn: BAD_SSN });
  await app.findByText(/last 4 digits of your SSN/i);

  await fireEvent.press(app.getByText('Sign In'));
  await app.findByLabelText(FULL_SSN_FIELD);
}

/**
 * Submit a wrong full SSN until the form locks, returning how many attempts it
 * took. The button is replaced by a spinner mid-request, so each attempt waits
 * for the form to settle — into either a usable button or the lockout panel.
 */
async function failUntilLocked(app: App, limit = 5): Promise<number> {
  let attempts = 0;

  while (app.queryByText('Sign In') && attempts < limit) {
    await fireEvent.changeText(app.getByLabelText(FULL_SSN_FIELD), '123450000');
    await fireEvent.press(app.getByText('Sign In'));
    attempts++;

    // Pressing doesn't flush the pending state synchronously, so wait for the
    // button to become a spinner before waiting for the form to come back —
    // otherwise the next pass presses a button that is about to disappear.
    await waitFor(() => expect(app.queryByText('Sign In')).toBeNull());
    await waitFor(() => {
      expect(app.queryByText('Sign In') ?? app.queryByText('Too many attempts')).not.toBeNull();
    });
  }

  return attempts;
}

describe('device hand-off', () => {
  it('shows the form on a device with no saved sign-in', async () => {
    const app = await openLogin();

    expect(app.getByLabelText(EMAIL_FIELD)).toBeTruthy();
    expect(app.getByLabelText(LAST4_FIELD)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('hands off to biometric unlock when this device has one saved', async () => {
    await SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify({ email: EMAIL, ssnLast4: GOOD_SSN }));

    await renderApp(<LoginScreen />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/unlock'));
  });

  it('shows the form anyway if the saved sign-in can no longer be used', async () => {
    await SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify({ email: EMAIL, ssnLast4: GOOD_SSN }));
    // e.g. the employee removed Face ID from the phone after enrolling.
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(false);

    const app = await openLogin();

    expect(app.getByLabelText(EMAIL_FIELD)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalledWith('/unlock');
  });

  it('prefills a remembered email', async () => {
    await SecureStore.setItemAsync(EMAIL_KEY, EMAIL);

    const app = await openLogin();

    expect(app.getByLabelText(EMAIL_FIELD).props.value).toBe(EMAIL);
  });

  it('offers biometrics up front when the phone supports them', async () => {
    const app = await openLogin();

    expect(app.getByText(/Turn on Face ID after you sign in/i)).toBeTruthy();
  });

  it('says nothing about biometrics on a phone without them', async () => {
    jest.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(false);

    const app = await openLogin();

    expect(app.queryByText(/Face ID/i)).toBeNull();
  });
});

describe('validation', () => {
  it('asks for the email before calling the backend', async () => {
    const app = await openLogin();
    await fireEvent.press(app.getByText('Sign In'));

    expect(await app.findByText('Please enter your email address.')).toBeTruthy();
  });

  it('asks for all four SSN digits', async () => {
    const app = await openLogin();
    await fireEvent.changeText(app.getByLabelText(EMAIL_FIELD), EMAIL);
    await fireEvent.changeText(app.getByLabelText(LAST4_FIELD), '48');
    await fireEvent.press(app.getByText('Sign In'));

    expect(await app.findByText('Enter the last 4 digits of your SSN.')).toBeTruthy();
  });

  it('keeps non-digits out of the last-4 field', async () => {
    const app = await openLogin();
    await fireEvent.changeText(app.getByLabelText(LAST4_FIELD), '4a8b2c1d9');

    expect(app.getByLabelText(LAST4_FIELD).props.value).toBe('4821');
  });

  it('explains an unrecognised email in the employee’s words', async () => {
    const app = await openLogin();
    await submit(app, { email: 'unknown@nowhere.test' });

    expect(await app.findByText(/don’t recognize that email address/i)).toBeTruthy();
  });

  it('tells an employee with a shared email to call payroll', async () => {
    const app = await openLogin();
    await submit(app, { email: 'shared@cascade.test' });

    expect(await app.findByText(/Please call Olympic Payroll/i)).toBeTruthy();
  });
});

describe('SSN escalation', () => {
  it('keeps asking for the last 4 on the first failure', async () => {
    const app = await openLogin();
    await submit(app, { ssn: BAD_SSN });

    expect(await app.findByText(/last 4 digits of your SSN/i)).toBeTruthy();
    expect(app.queryByLabelText(FULL_SSN_FIELD)).toBeNull();
  });

  it('asks for the full SSN after two failures', async () => {
    const app = await openLogin();
    await escalate(app);

    expect(app.getByLabelText(FULL_SSN_FIELD)).toBeTruthy();
    expect(app.queryByLabelText(LAST4_FIELD)).toBeNull();
    expect(app.getByText(/we need your full Social Security number/i)).toBeTruthy();
  });

  it('formats the full SSN as it is typed', async () => {
    const app = await openLogin();
    await escalate(app);
    await fireEvent.changeText(app.getByLabelText(FULL_SSN_FIELD), '123456789');

    expect(app.getByLabelText(FULL_SSN_FIELD).props.value).toBe('123-45-6789');
  });

  it('requires all nine digits', async () => {
    const app = await openLogin();
    await escalate(app);
    await fireEvent.changeText(app.getByLabelText(FULL_SSN_FIELD), '12345');
    await fireEvent.press(app.getByText('Sign In'));

    expect(await app.findByText('Enter all 9 digits of your Social Security number.')).toBeTruthy();
  });

  it('stops blaming the last 4 digits once the full SSN is being asked for', async () => {
    const app = await openLogin();
    await escalate(app);
    await fireEvent.changeText(app.getByLabelText(FULL_SSN_FIELD), '123450000');
    await fireEvent.press(app.getByText('Sign In'));

    expect(await app.findByText(/match the Social Security number on your payroll record/i)).toBeTruthy();
  });

  it('locks the form after three full-SSN failures', async () => {
    const app = await openLogin();
    await escalate(app);
    const attempts = await failUntilLocked(app);

    expect(attempts).toBe(3);
    expect(app.getByText('Too many attempts')).toBeTruthy();
    expect(app.queryByText('Sign In')).toBeNull();
    expect(app.getByText(/call Olympic Payroll for help/i)).toBeTruthy();
  });

  it('lets the employee start over after a lockout', async () => {
    const app = await openLogin();
    await escalate(app);
    await failUntilLocked(app);
    await fireEvent.press(app.getByText('Start Over'));

    // Back to the beginning: last 4 again, no error, form usable.
    expect(await app.findByLabelText(LAST4_FIELD)).toBeTruthy();
    expect(app.queryByText('Too many attempts')).toBeNull();
    expect(app.getByText('Sign In')).toBeTruthy();
  });
});

describe('successful sign-in', () => {
  beforeEach(() => {
    // Without biometric hardware the screen skips the "enable Face ID?" prompt
    // and goes straight on, which is the navigation we want to observe.
    jest.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(false);
  });

  it('sends a multi-employer account to the company picker', async () => {
    const app = await openLogin();
    await submit(app);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/companies'));
  });

  it('sends a single-employer account straight to the dashboard', async () => {
    const app = await openLogin();
    await submit(app, { email: 'solo@cascade.test' });

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
  });

  it('does not remember the email unless asked', async () => {
    // The toggle starts off on a device that has never remembered an email.
    const app = await openLogin();
    await submit(app);
    await waitFor(() => expect(router.replace).toHaveBeenCalled());

    await expect(SecureStore.getItemAsync(EMAIL_KEY)).resolves.toBeNull();
  });

  it('remembers the email when the employee turns it on', async () => {
    const app = await openLogin();
    await fireEvent(app.getByLabelText(REMEMBER_SWITCH), 'valueChange', true);
    await submit(app);
    await waitFor(() => expect(router.replace).toHaveBeenCalled());

    await expect(SecureStore.getItemAsync(EMAIL_KEY)).resolves.toBe(EMAIL);
  });

  /**
   * The one rule that must never regress: an SSN may live in the biometric
   * vault only, and only after the employee opts in. A plain sign-in must
   * leave no trace of it on the device.
   */
  it('never writes the SSN to the device', async () => {
    const app = await openLogin();
    // Remember-me on, so the keychain holds something and the assertion is
    // about *what* it holds rather than it happening to be empty.
    await fireEvent(app.getByLabelText(REMEMBER_SWITCH), 'valueChange', true);
    await submit(app);
    await waitFor(() => expect(router.replace).toHaveBeenCalled());

    const persisted = JSON.stringify([...keychain().entries()]);
    expect(persisted).toContain(EMAIL);
    expect(persisted).not.toContain(GOOD_SSN);
    expect(keychain().has(CREDENTIAL_KEY)).toBe(false);
  });
});
