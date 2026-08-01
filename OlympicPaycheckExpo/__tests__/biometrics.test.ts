import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  clearCredential,
  getCapability,
  hasSavedCredential,
  readCredential,
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

describe('credential vault', () => {
  const credential = { email: 'sarah@cascade.test', ssnLast4: '4821', name: 'Sarah Mitchell' };

  it('has nothing enrolled on a fresh device', async () => {
    await expect(hasSavedCredential()).resolves.toBe(false);
    await expect(readCredential()).resolves.toBeNull();
  });

  it('round-trips a saved credential', async () => {
    await expect(saveCredential(credential)).resolves.toBe(true);

    await expect(hasSavedCredential()).resolves.toBe(true);
    await expect(readCredential()).resolves.toEqual(credential);
  });

  it('pins the credential to this device only', async () => {
    await saveCredential(credential);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
  });

  it('erases the credential on opt-out', async () => {
    await saveCredential(credential);
    await clearCredential();

    await expect(hasSavedCredential()).resolves.toBe(false);
    await expect(readCredential()).resolves.toBeNull();
  });

  it('reports failure rather than throwing when the keychain refuses', async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('keychain locked'));

    await expect(saveCredential(credential)).resolves.toBe(false);
  });

  it('treats a corrupted credential as absent instead of crashing', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('{not json');

    await expect(readCredential()).resolves.toBeNull();
  });

  it('survives clearing when nothing is stored', async () => {
    await expect(clearCredential()).resolves.toBeUndefined();
  });
});
