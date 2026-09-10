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
 *   3. On the next launch, reading the gated item *is* the biometric prompt,
 *      and the only one the employee sees. `verify()` runs instead only for an
 *      enrolment stored without the OS gate (Expo Go, or one written by an
 *      older build), so every unlock asks for exactly one scan.
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

/** Outcomes of an OS biometric prompt that did not pass. All are worth retrying. */
export type GateFailure = 'cancelled' | 'failed' | 'lockout' | 'unavailable';

/**
 * Why a credential read produced nothing.
 *   • `missing` — nothing is enrolled on this device.
 *   • `locked`  — an enrolment exists but its secret can never be read again.
 *     The key was invalidated when the device's biometric set changed (Android
 *     reports this by returning nothing at all; iOS drops `.biometryCurrentSet`
 *     items), or the stored value is corrupt. Retrying cannot help, so callers
 *     should clear the enrolment and send the employee to re-enrol.
 *   • a `GateFailure` — the OS prompt guarding the read did not pass.
 */
export type CredentialResult =
  | { ok: true; credential: SavedCredential }
  | { ok: false; reason: 'missing' | 'locked' | GateFailure };

/**
 * Outcome of enrolling. On Android the gated write itself asks for a
 * fingerprint, so `cancelled` means the employee dismissed that prompt.
 */
export type SaveResult = 'saved' | 'cancelled' | 'failed';

/** What the device will actually use, so copy matches the real prompt. */
export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export type BiometricCapability = {
  /** Hardware exists AND a biometric strong enough for payroll is enrolled. */
  available: boolean;
  kind: BiometricKind;
  /** Display name, e.g. "Face ID", "Touch ID", "Fingerprint". */
  label: string;
};

export type VerifyResult = { ok: true } | { ok: false; reason: GateFailure };

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

/**
 * Title of the OS prompt the gated item presents. For an OS-gated enrolment
 * this is the unlock prompt itself, so it reads like one.
 */
const AUTH_PROMPT = 'Sign in to Olympic Paycheck';

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

/**
 * Translate an error from a gated secure-store operation into what happened.
 *
 * expo-secure-store reports the outcome of its biometric prompt only as error
 * text (Android: "Could not Authenticate the user: User canceled the
 * authentication…", iOS: "User canceled the operation."), so the text is all
 * there is to go on. Anything that is not about the prompt, such as a decrypt
 * or keystore failure, means the stored value itself is unusable.
 */
function classifyGateError(error: unknown): GateFailure | 'locked' {
  const text = String((error as { message?: unknown } | null)?.message ?? error).toLowerCase();
  const mentions = (...fragments: string[]) => fragments.some((fragment) => text.includes(fragment));

  // Dismissed, or interrupted before it could finish: worth another go.
  if (mentions('cancel', 'already in progress', 'not in the foreground', 'interaction is not allowed', 'timeout')) {
    return 'cancelled';
  }
  if (mentions('lockout')) return 'lockout';
  if (
    mentions(
      'no biometrics',
      'not enrolled',
      'no hardware',
      'hardware unavailable',
      'hardware not present',
      'unsupported',
      'security update',
      'requires android api',
    )
  ) {
    return 'unavailable';
  }
  // The prompt ran and did not pass.
  if (mentions('authenticat')) return 'failed';
  return 'locked';
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
): Promise<SaveResult> {
  const enrollment: Enrollment = { name: meta.name, secured: OS_AUTH_SUPPORTED };
  try {
    // The gated write is the one that can prompt (Android needs a biometric to
    // use the key, even to encrypt) and the one that can fail (no
    // NSFaceIDUsageDescription, keystore full, biometrics removed mid-flow).
    await SecureStore.setItemAsync(SECRET_KEY, JSON.stringify(credential), secretOptions());
    await SecureStore.setItemAsync(META_KEY, JSON.stringify(enrollment), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    // Roll back the new layout only. A legacy item, if one is being migrated,
    // is deliberately left alone — losing it here would silently un-enrol a
    // device that was working a moment ago.
    await discard(SECRET_KEY);
    await discard(META_KEY);
    return classifyGateError(error) === 'cancelled' ? 'cancelled' : 'failed';
  }

  // Both halves landed; the pre-split item is now redundant.
  await discard(LEGACY_KEY);
  return 'saved';
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
 * For an OS-gated enrolment this call presents the biometric prompt itself, so
 * callers must not run `verify()` first. It never throws: a prompt that did not
 * pass comes back as its `GateFailure`, and a secret that can never be read
 * again comes back as `locked`.
 */
export async function readCredential(): Promise<CredentialResult> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(SECRET_KEY, secretOptions());
  } catch (error) {
    // Either the prompt guarding the read did not pass, which is worth a
    // retry, or the value could not be decrypted, which is permanent.
    return { ok: false, reason: classifyGateError(error) };
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

  // No usable secret anywhere. If an enrolment record still exists, the secret
  // behind it is gone for good: Android returns nothing for a key invalidated
  // by a biometric change instead of throwing, and a corrupt value is no
  // better. Calling that `missing` sent the employee to the login screen,
  // which saw the enrolment and sent them straight back to unlock, forever.
  if (raw === null && !(await hasSavedCredential())) {
    return { ok: false, reason: 'missing' };
  }
  return { ok: false, reason: 'locked' };
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
