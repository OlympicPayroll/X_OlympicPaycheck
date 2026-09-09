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
 *      expo-secure-store, encrypted at rest with hardware-backed keys AND
 *      gated by `requireAuthentication` so the OS itself refuses to hand the
 *      bytes back without a biometric match.
 *   3. On the next launch the read is what triggers the prompt; the app's own
 *      `verify()` call is a second, earlier gate rather than the only one.
 *
 * Storage is deliberately split in two:
 *   • META_KEY   — display name + enrolment flag. Not secret, never gated, so
 *                  the unlock screen can greet the employee and the login
 *                  screen can detect enrolment without touching the secret.
 *   • SECRET_KEY — email + SSN digits. Gated. Read only after a biometric pass.
 *
 * The credential never leaves the device and is never written to app storage,
 * AsyncStorage, or logs. Opting out (or signing out from Profile) erases it.
 *
 * TODO(backend): once Olympic Payroll can issue a per-device token, switch to
 * "Option A" — store only that opaque token instead of the SSN. That matches
 * the Employee Access promise that SSNs are not stored on the device.
 */

/** Gated: email + SSN digits. Requires a biometric match to read. */
const SECRET_KEY = 'olympic.paycheck.credential.v2';
/** Ungated: display name and the fact that an enrolment exists. */
const META_KEY = 'olympic.paycheck.enrollment';
/** Pre-split, ungated credential. Migrated forward on first read, then erased. */
const LEGACY_KEY = 'olympic.paycheck.credential';

export type SavedCredential = {
  email: string;
  ssnLast4: string;
};

/** The non-secret half — safe to read before authenticating. */
export type Enrollment = {
  /** Display name, so the unlock screen can greet them before signing in. */
  name?: string;
  /** False when stored without an OS-level gate (Expo Go, or a legacy item). */
  secured: boolean;
};

/**
 * Why a credential read produced nothing.
 *   • `missing` — nothing is enrolled on this device.
 *   • `locked`  — something IS enrolled but the OS refused to release it. On
 *     iOS this is what an invalidated key looks like after the employee adds a
 *     fingerprint or re-enrols Face ID: `.biometryCurrentSet` ties the item to
 *     the biometric set that existed when it was written. It is unrecoverable,
 *     so the UI must offer "forget this device" rather than a bare retry.
 */
export type CredentialResult =
  | { ok: true; credential: SavedCredential }
  | { ok: false; reason: 'missing' | 'locked' };

/** What the device will actually use, so copy matches the real prompt. */
export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export type BiometricCapability = {
  /** Hardware exists AND a biometric strong enough for payroll is enrolled. */
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
 * Face ID cannot work inside Expo Go: the sandbox's own Info.plist doesn't
 * declare NSFaceIDUsageDescription for hosted projects, so iOS refuses the
 * biometric request and silently offers the device passcode instead. (Expo
 * documents this — Face ID requires a development build.) Android is fine,
 * because BiometricPrompt needs no equivalent per-app usage string.
 *
 * Detecting it here means we advertise biometrics only where they can really
 * run, instead of sending the employee to an unlock screen that can't succeed.
 */
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const FACE_ID_BLOCKED_BY_EXPO_GO = Platform.OS === 'ios' && IS_EXPO_GO;

/**
 * Whether the keychain item can carry an OS-enforced auth gate.
 *
 * `requireAuthentication` needs the same NSFaceIDUsageDescription that Expo Go
 * lacks, so in Expo Go we must store ungated or not at all. We still store —
 * losing the demo build's biometrics entirely would be worse — but the
 * enrolment records `secured: false` so the UI can tell the truth about it.
 */
export const OS_AUTH_SUPPORTED = !IS_EXPO_GO;

/** Shown by the OS when the gated item is read. */
const AUTH_PROMPT = 'Unlock your saved Olympic Paycheck sign-in';

function secretOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: OS_AUTH_SUPPORTED,
    authenticationPrompt: AUTH_PROMPT,
  };
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
export async function getCapability(): Promise<BiometricCapability> {
  if (FACE_ID_BLOCKED_BY_EXPO_GO) {
    return { available: false, kind: 'none', label: labelFor('none') };
  }
  try {
    const [hasHardware, isEnrolled, types, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
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

    /**
     * `isEnrolledAsync()` is not strict enough on Android on its own: Expo
     * implements it as `canAuthenticate(BIOMETRIC_WEAK) == SUCCESS`, so a phone
     * with nothing but Class 2 camera face unlock reports "enrolled". We then
     * prompt with `biometricsSecurityLevel: 'strong'`, which that device can
     * never satisfy — the employee would be offered a setup they can't use.
     * Requiring BIOMETRIC_STRONG here keeps the advertisement and the prompt
     * talking about the same authenticator.
     *
     * iOS has no weak tier: Face ID and Touch ID are both Class 3 equivalents,
     * and `getEnrolledLevelAsync()` reports SECRET when only a passcode is set,
     * which `isEnrolledAsync()` already excludes.
     */
    const strongEnough =
      Platform.OS !== 'android' || level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG;

    return {
      available: hasHardware && isEnrolled && strongEnough && kind !== 'none',
      kind,
      label: labelFor(kind),
    };
  } catch {
    return { available: false, kind: 'none', label: labelFor('none') };
  }
}

/** Only one OS prompt may be in flight; a second call joins the first. */
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

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Is a credential enrolled on this device? Never reads the secret. */
export async function hasSavedCredential(): Promise<boolean> {
  try {
    if (await SecureStore.getItemAsync(META_KEY)) return true;
    return (await SecureStore.getItemAsync(LEGACY_KEY)) !== null;
  } catch {
    return false;
  }
}

/**
 * The non-secret half of the enrolment: who to greet, and whether the OS is
 * enforcing the gate. Safe to call before authenticating — that is the point.
 */
export async function readEnrollment(): Promise<Enrollment | null> {
  try {
    const meta = parse<Enrollment>(await SecureStore.getItemAsync(META_KEY));
    if (meta) return { name: meta.name, secured: meta.secured ?? false };

    // Pre-split enrolment: the whole credential is ungated, so reading the
    // name here discloses nothing that wasn't already unprotected. It is
    // upgraded to the split, gated layout on the next successful unlock.
    const legacy = parse<SavedCredential & { name?: string }>(await SecureStore.getItemAsync(LEGACY_KEY));
    return legacy ? { name: legacy.name, secured: false } : null;
  } catch {
    return null;
  }
}

/** Store the credential for future biometric sign-in. */
export async function saveCredential(
  credential: SavedCredential,
  meta: { name?: string } = {},
): Promise<boolean> {
  const enrollment: Enrollment = { name: meta.name, secured: OS_AUTH_SUPPORTED };
  try {
    // The gated write is the one that can fail (no NSFaceIDUsageDescription,
    // keystore full, biometrics removed mid-flow).
    await SecureStore.setItemAsync(SECRET_KEY, JSON.stringify(credential), secretOptions());
    await SecureStore.setItemAsync(META_KEY, JSON.stringify(enrollment), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Roll back the new layout only. A legacy item, if one is being migrated,
    // is deliberately left alone — losing it here would silently un-enrol a
    // device that was working a moment ago.
    await discard(SECRET_KEY);
    await discard(META_KEY);
    return false;
  }

  // Both halves landed; the pre-split item is now redundant.
  await discard(LEGACY_KEY);
  return true;
}

/** Best-effort delete of one key. Never throws. */
async function discard(key: string): Promise<boolean> {
  try {
    // Deleting a gated item does not itself prompt, but pass the same options
    // so the keychain service name matches the one we wrote to.
    await SecureStore.deleteItemAsync(key, key === SECRET_KEY ? secretOptions() : undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the stored credential.
 *
 * Call only after `verify()` succeeds — but note the OS gate means this call
 * may itself present a prompt, and may fail permanently if the biometric set
 * changed since enrolment. Callers must handle `locked`.
 */
export async function readCredential(): Promise<CredentialResult> {
  let raw: string | null = null;
  try {
    raw = await SecureStore.getItemAsync(SECRET_KEY, secretOptions());
  } catch {
    // Distinguish "the gate refused" from "nothing is here": an enrolment that
    // still exists but can't be opened needs different copy and a way out.
    return { ok: false, reason: (await hasSavedCredential()) ? 'locked' : 'missing' };
  }

  const credential = parse<SavedCredential>(raw);
  if (credential?.email && credential.ssnLast4) {
    return { ok: true, credential };
  }

  // Nothing usable in the gated slot — an ungated enrolment from an older
  // build may still be here. Read it, then upgrade it in place so the next
  // unlock is OS-enforced.
  const legacy = parse<SavedCredential & { name?: string }>(await readLegacy());
  if (legacy?.email && legacy.ssnLast4) {
    const migrated = { email: legacy.email, ssnLast4: legacy.ssnLast4 };
    await saveCredential(migrated, { name: legacy.name });
    return { ok: true, credential: migrated };
  }

  // Something was stored but it isn't a credential — truncated write, a
  // half-finished migration, keychain corruption. Unrecoverable in the same
  // way an invalidated key is, and it deserves the same exit: re-enrol.
  return { ok: false, reason: raw === null ? 'missing' : 'locked' };
}

async function readLegacy(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LEGACY_KEY);
  } catch {
    return null;
  }
}

/**
 * Erase the credential — on opt-out, sign-out, repeated failure, or when the
 * OS gate has become unopenable.
 *
 * Returns false if anything survived, so callers can say so rather than
 * claiming the device was forgotten when it wasn't.
 */
export async function clearCredential(): Promise<boolean> {
  const results = await Promise.all([SECRET_KEY, META_KEY, LEGACY_KEY].map(discard));
  return results.every(Boolean);
}
