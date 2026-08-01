import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Biometric sign-in (Face ID / Touch ID / fingerprint).
 *
 * How it works today (see REACT_MIGRATION_PLAN.md §8, "Option B"):
 *   1. After a successful manual sign-in the employee may opt in.
 *   2. Their credential is written to the OS keychain / keystore via
 *      expo-secure-store, which encrypts it at rest with hardware-backed keys.
 *   3. On the next launch we require a biometric match BEFORE reading it back,
 *      then replay it to the normal sign-in call.
 *
 * The credential never leaves the device and is never written to app storage,
 * AsyncStorage, or logs. Opting out (or signing out from Profile) erases it.
 *
 * TODO(backend): once Olympic Payroll can issue a per-device token, switch to
 * "Option A" — store only that opaque token instead of the SSN. That matches
 * the Employee Access promise that SSNs are not stored on the device.
 */

const CREDENTIAL_KEY = 'olympic.paycheck.credential';

export type SavedCredential = {
  email: string;
  ssnLast4: string;
  /** Display name, so the unlock screen can greet them before signing in. */
  name?: string;
};

/** What the device will actually use, so copy matches the real prompt. */
export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export type BiometricCapability = {
  /** Hardware exists AND the user has enrolled a biometric. */
  available: boolean;
  kind: BiometricKind;
  /** Display name, e.g. "Face ID", "Touch ID", "Fingerprint". */
  label: string;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'failed' | 'lockout' | 'unavailable' };

function labelFor(kind: BiometricKind): string {
  if (Platform.OS === 'ios') {
    if (kind === 'face') return 'Face ID';
    if (kind === 'fingerprint') return 'Touch ID';
    return 'Biometrics';
  }
  if (kind === 'fingerprint') return 'Fingerprint';
  if (kind === 'face') return 'Face Unlock';
  if (kind === 'iris') return 'Iris';
  return 'Biometrics';
}

/**
 * Which biometric the OS will actually present.
 *
 * This is platform-specific on purpose:
 *   • iOS — Face ID and Touch ID are both strong authenticators, and a device
 *     has exactly one of them. Prefer Face ID when present.
 *   • Android — most phones report BOTH face and fingerprint, but camera-based
 *     face unlock is usually Class 2 ("weak") and is rejected by a strong
 *     BiometricPrompt, so the OS falls back to the fingerprint sensor. Naming it
 *     "Face Unlock" would therefore be a lie. Fingerprint (Class 3, "strong") is
 *     both what actually runs and the more secure option, so it wins.
 */
/**
 * Face ID cannot work inside Expo Go: the sandbox's own Info.plist doesn't
 * declare NSFaceIDUsageDescription for hosted projects, so iOS refuses the
 * biometric request and silently offers the device passcode instead. (Expo
 * documents this — Face ID requires a development build.) Android is fine,
 * because BiometricPrompt needs no equivalent per-app usage string.
 *
 * Detecting it here means we advertise biometrics only where they can really
 * run, instead of sending the employee to an unlock screen that can't succeed.
 */
const FACE_ID_BLOCKED_BY_EXPO_GO =
  Platform.OS === 'ios' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export async function getCapability(): Promise<BiometricCapability> {
  if (FACE_ID_BLOCKED_BY_EXPO_GO) {
    return { available: false, kind: 'none', label: labelFor('none') };
  }
  try {
    const [hasHardware, isEnrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const hasIris = types.includes(LocalAuthentication.AuthenticationType.IRIS);

    let kind: BiometricKind = 'none';
    if (Platform.OS === 'ios') {
      kind = hasFace ? 'face' : hasFingerprint ? 'fingerprint' : 'none';
    } else {
      kind = hasFingerprint ? 'fingerprint' : hasFace ? 'face' : hasIris ? 'iris' : 'none';
    }

    return { available: hasHardware && isEnrolled && kind !== 'none', kind, label: labelFor(kind) };
  } catch {
    return { available: false, kind: 'none', label: labelFor('none') };
  }
}

/** Only one OS prompt may be in flight; a second call cancels the first. */
let inFlight: Promise<VerifyResult> | null = null;

/** Prompt for a biometric match, distinguishing cancellation from failure. */
export function verify(promptMessage: string): Promise<VerifyResult> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<VerifyResult> => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: 'Use email instead',
        // Biometric or nothing. With the OS passcode fallback enabled, iOS
        // silently swaps in the passcode keypad whenever Face ID is refused
        // (permission denied, or locked out after failed attempts) — which
        // hides the real problem and isn't the "sign in with your face"
        // experience we're promising. The app's own fallback is the email
        // form, which is a deliberate choice rather than a silent downgrade.
        disableDeviceFallback: true,
        // Android: require a Class 3 ("strong") authenticator. This is what
        // makes the OS present the fingerprint sensor rather than the weaker
        // camera face unlock — appropriate for payroll data.
        biometricsSecurityLevel: 'strong',
      });

      if (result.success) return { ok: true };

      const error = 'error' in result ? result.error : '';
      if (['user_cancel', 'system_cancel', 'app_cancel', 'user_fallback'].includes(error)) {
        return { ok: false, reason: 'cancelled' };
      }
      if (error.startsWith('lockout')) return { ok: false, reason: 'lockout' };
      if (['not_enrolled', 'not_available', 'passcode_not_set'].includes(error)) {
        return { ok: false, reason: 'unavailable' };
      }
      return { ok: false, reason: 'failed' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Is a credential enrolled on this device? */
export async function hasSavedCredential(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(CREDENTIAL_KEY)) !== null;
  } catch {
    return false;
  }
}

/** Store the credential for future biometric sign-in. */
export async function saveCredential(credential: SavedCredential): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify(credential), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      // TODO(dev-build): add `requireAuthentication: true` for an OS-level gate.
      // It needs a custom dev/production build — it is not supported in Expo Go.
    });
    return true;
  } catch {
    return false;
  }
}

/** Read the stored credential. Call only after `verify()` succeeds. */
export async function readCredential(): Promise<SavedCredential | null> {
  try {
    const raw = await SecureStore.getItemAsync(CREDENTIAL_KEY);
    return raw ? (JSON.parse(raw) as SavedCredential) : null;
  } catch {
    return null;
  }
}

/** Erase the credential — on opt-out, sign-out, or repeated failure. */
export async function clearCredential(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CREDENTIAL_KEY);
  } catch {
    // Nothing stored, or the keychain is unavailable — nothing to do.
  }
}
