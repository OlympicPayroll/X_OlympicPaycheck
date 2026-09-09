import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  clearCredential,
  getCapability,
  hasSavedCredential,
  readCredential,
  readEnrollment,
  saveCredential,
  verify,
} from '@/lib/biometrics';

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const { FINGERPRINT, FACIAL_RECOGNITION, IRIS } = LocalAuthentication.AuthenticationType;

/** `Platform.OS` is a plain property on the RN Platform object. */
function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

afterEach(() => setPlatform('ios'));

describe('getCapability', () => {
  it('reports Face ID on a face-unlock iPhone', async () => {
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([FACIAL_RECOGNITION]);

    await expect(getCapability()).resolves.toEqual({ available: true, kind: 'face', label: 'Face ID' });
  });

  it('reports Touch ID on a fingerprint iPhone', async () => {
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([FINGERPRINT]);

    await expect(getCapability()).resolves.toEqual({ available: true, kind: 'fingerprint', label: 'Touch ID' });
  });

  /**
   * Android phones usually report face *and* fingerprint, but camera face
   * unlock is Class 2 and a strong BiometricPrompt rejects it — so the sensor
   * that actually runs is the fingerprint reader, and that's what we must name.
   */
  it('prefers the fingerprint sensor on Android even when face is reported', async () => {
    setPlatform('android');
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([FACIAL_RECOGNITION, FINGERPRINT]);

    await expect(getCapability()).resolves.toEqual({
      available: true,
      kind: 'fingerprint',
      label: 'Fingerprint',
    });
  });

  it('falls back to iris on Android hardware that offers nothing else', async () => {
    setPlatform('android');
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([IRIS]);

    await expect(getCapability()).resolves.toMatchObject({ available: true, kind: 'iris', label: 'Iris' });
  });

  it('is unavailable without biometric hardware', async () => {
    auth.hasHardwareAsync.mockResolvedValue(false);

    await expect(getCapability()).resolves.toMatchObject({ available: false });
  });

  it('is unavailable when the employee has enrolled no biometric', async () => {
    auth.isEnrolledAsync.mockResolvedValue(false);

    await expect(getCapability()).resolves.toMatchObject({ available: false });
  });

  it('is unavailable when the OS reports no usable authenticator', async () => {
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([]);

    await expect(getCapability()).resolves.toEqual({ available: false, kind: 'none', label: 'Biometrics' });
  });

  it('degrades quietly if the OS query throws', async () => {
    auth.hasHardwareAsync.mockRejectedValue(new Error('binder died'));

    await expect(getCapability()).resolves.toMatchObject({ available: false, kind: 'none' });
  });
});

describe('verify', () => {
  it('reports success', async () => {
    await expect(verify('Sign in')).resolves.toEqual({ ok: true });
  });

  it('demands a real biometric rather than falling back to the passcode', async () => {
    await verify('Sign in');

    expect(auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        disableDeviceFallback: true,
        biometricsSecurityLevel: 'strong',
      }),
    );
  });

  it.each(['user_cancel', 'system_cancel', 'app_cancel', 'user_fallback'])(
    'treats %s as a cancellation, not a failure',
    async (error) => {
      auth.authenticateAsync.mockResolvedValue({ success: false, error } as never);

      await expect(verify('Sign in')).resolves.toEqual({ ok: false, reason: 'cancelled' });
    },
  );

  it.each(['lockout', 'lockout_permanent'])('recognises %s as a lockout', async (error) => {
    auth.authenticateAsync.mockResolvedValue({ success: false, error } as never);

    await expect(verify('Sign in')).resolves.toEqual({ ok: false, reason: 'lockout' });
  });

  it.each(['not_enrolled', 'not_available', 'passcode_not_set'])(
    'recognises %s as unavailable',
    async (error) => {
      auth.authenticateAsync.mockResolvedValue({ success: false, error } as never);

      await expect(verify('Sign in')).resolves.toEqual({ ok: false, reason: 'unavailable' });
    },
  );

  it('treats a genuine mismatch as a failure', async () => {
    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'authentication_failed' } as never);

    await expect(verify('Sign in')).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('never rejects, even when the OS call throws', async () => {
    auth.authenticateAsync.mockRejectedValue(new Error('no activity'));

    await expect(verify('Sign in')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('shows only one OS prompt when called twice in a row', async () => {
    auth.authenticateAsync.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true } as never), 10)),
    );

    const first = verify('Sign in');
    const second = verify('Sign in');
    expect(second).toBe(first);

    await Promise.all([first, second]);
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh prompt once the previous one settles', async () => {
    await verify('Sign in');
    await verify('Sign in');

    expect(auth.authenticateAsync).toHaveBeenCalledTimes(2);
  });
});


describe('Android authentication strength', () => {
  /**
   * Expo implements `isEnrolledAsync()` on Android as
   * `canAuthenticate(BIOMETRIC_WEAK) == SUCCESS`, but `verify()` prompts with
   * `biometricsSecurityLevel: 'strong'`. Advertising biometrics off the weak
   * check offers a setup the device can never satisfy.
   */
  it('refuses a device enrolled only for weak face unlock', async () => {
    setPlatform('android');
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([FACIAL_RECOGNITION]);
    auth.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK);

    await expect(getCapability()).resolves.toMatchObject({ available: false });
  });

  it('accepts a device with a strong fingerprint enrolled', async () => {
    setPlatform('android');
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([FINGERPRINT]);
    auth.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);

    await expect(getCapability()).resolves.toMatchObject({ available: true, kind: 'fingerprint' });
  });

  it('refuses a device with only a passcode enrolled', async () => {
    setPlatform('android');
    auth.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.SECRET);

    await expect(getCapability()).resolves.toMatchObject({ available: false });
  });

  /** iOS has no weak tier: Face ID and Touch ID are both Class 3 equivalents. */
  it('does not apply the Android strength rule to iOS', async () => {
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([FACIAL_RECOGNITION]);
    auth.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK);

    await expect(getCapability()).resolves.toMatchObject({ available: true, kind: 'face' });
  });
});

describe('credential vault', () => {
  const credential = { email: 'sarah@cascade.test', ssnLast4: '4821' };
  const meta = { name: 'Sarah Mitchell' };

  it('has nothing enrolled on a fresh device', async () => {
    await expect(hasSavedCredential()).resolves.toBe(false);
    await expect(readCredential()).resolves.toEqual({ ok: false, reason: 'missing' });
    await expect(readEnrollment()).resolves.toBeNull();
  });

  it('round-trips a saved credential', async () => {
    await expect(saveCredential(credential, meta)).resolves.toBe(true);

    await expect(hasSavedCredential()).resolves.toBe(true);
    await expect(readCredential()).resolves.toEqual({ ok: true, credential });
  });

  it('pins the credential to this device only', async () => {
    await saveCredential(credential, meta);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
  });

  /**
   * The gate has to be the OS's, not the app's. Without `requireAuthentication`
   * the keychain hands the bytes to anything running as this app, and the only
   * thing between an attacker and the SSN digits is our own `if`.
   */
  it('asks the OS to enforce authentication on the secret', async () => {
    await saveCredential(credential, meta);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(credential),
      expect.objectContaining({ requireAuthentication: true }),
    );
  });

  it('reads the secret back through the same gate it was written with', async () => {
    await saveCredential(credential, meta);
    jest.mocked(SecureStore.getItemAsync).mockClear();

    await readCredential();

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ requireAuthentication: true }),
    );
  });

  /**
   * The greeting name must be reachable without opening the vault — otherwise
   * merely showing the unlock screen pulls the SSN digits into memory before
   * anyone has authenticated.
   */
  it('exposes the greeting name without touching the secret', async () => {
    await saveCredential(credential, meta);
    jest.mocked(SecureStore.getItemAsync).mockClear();

    await expect(readEnrollment()).resolves.toEqual({ name: 'Sarah Mitchell', secured: true });

    const keysRead = jest.mocked(SecureStore.getItemAsync).mock.calls.map(([key]) => key);
    expect(keysRead).not.toContain('olympic.paycheck.credential.v2');
  });

  it('detects enrolment without touching the secret', async () => {
    await saveCredential(credential, meta);
    jest.mocked(SecureStore.getItemAsync).mockClear();

    await expect(hasSavedCredential()).resolves.toBe(true);

    const keysRead = jest.mocked(SecureStore.getItemAsync).mock.calls.map(([key]) => key);
    expect(keysRead).not.toContain('olympic.paycheck.credential.v2');
  });

  it('erases both halves on opt-out', async () => {
    await saveCredential(credential, meta);
    await expect(clearCredential()).resolves.toBe(true);

    await expect(hasSavedCredential()).resolves.toBe(false);
    await expect(readCredential()).resolves.toEqual({ ok: false, reason: 'missing' });
    await expect(readEnrollment()).resolves.toBeNull();
  });

  it('reports failure rather than throwing when the keychain refuses', async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('keychain locked'));

    await expect(saveCredential(credential, meta)).resolves.toBe(false);
  });

  it('leaves nothing half-enrolled when the secret write fails', async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('keychain locked'));

    await saveCredential(credential, meta);

    await expect(hasSavedCredential()).resolves.toBe(false);
  });

  it('says so when the erase did not take', async () => {
    await saveCredential(credential, meta);
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('keychain busy'));

    await expect(clearCredential()).resolves.toBe(false);
  });

  /**
   * An invalidated key — the employee added a fingerprint, so iOS dropped the
   * `.biometryCurrentSet` item — is not the same as "never enrolled". The
   * unlock screen shows different copy and hides Try Again for it.
   */
  it('distinguishes a locked vault from an empty one', async () => {
    await saveCredential(credential, meta);
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('key invalidated'));

    await expect(readCredential()).resolves.toEqual({ ok: false, reason: 'locked' });
  });

  it('treats a corrupted credential as locked rather than crashing', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('{not json');

    await expect(readCredential()).resolves.toEqual({ ok: false, reason: 'locked' });
  });

  it('survives clearing when nothing is stored', async () => {
    await expect(clearCredential()).resolves.toBe(true);
  });
});

describe('migration from the pre-split credential', () => {
  const legacy = { email: 'sarah@cascade.test', ssnLast4: '4821', name: 'Sarah Mitchell' };

  /** Seed the old ungated layout, exactly as an earlier build left it. */
  async function seedLegacy() {
    await SecureStore.setItemAsync('olympic.paycheck.credential', JSON.stringify(legacy));
    jest.mocked(SecureStore.setItemAsync).mockClear();
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
  }

  it('still recognises an enrolment written by the old build', async () => {
    await seedLegacy();

    await expect(hasSavedCredential()).resolves.toBe(true);
    await expect(readEnrollment()).resolves.toEqual({ name: 'Sarah Mitchell', secured: false });
  });

  it('returns the old credential rather than forcing a re-enrolment', async () => {
    await seedLegacy();

    await expect(readCredential()).resolves.toEqual({
      ok: true,
      credential: { email: 'sarah@cascade.test', ssnLast4: '4821' },
    });
  });

  it('upgrades it to the gated layout and drops the ungated copy', async () => {
    await seedLegacy();

    await readCredential();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('olympic.paycheck.credential', undefined);
    await expect(readEnrollment()).resolves.toEqual({ name: 'Sarah Mitchell', secured: true });
  });

  /** Losing a working enrolment because the upgrade failed would be worse. */
  it('keeps the old credential when the upgrade cannot be written', async () => {
    await seedLegacy();
    jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('keychain locked'));

    await expect(readCredential()).resolves.toMatchObject({ ok: true });

    jest.mocked(SecureStore.setItemAsync).mockReset();
    await expect(hasSavedCredential()).resolves.toBe(true);
  });
});
