import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { useSignIn } from '@/api/queries';
import { messageFor } from '@/api/types';
import { Logo } from '@/components/logo';
import { Button, Screen } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  clearCredential,
  getCapability,
  readCredential,
  readEnrollment,
  verify,
  type BiometricCapability,
} from '@/lib/biometrics';
import { MANUAL_LOGIN_PARAMS } from '@/lib/routes';

/** Face-scan outline, used when the device does facial recognition. */
function FaceGlyph({ color, size = 46 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <Path d="M9 9.5v1.5M15 9.5v1.5M12 9.5v3l-1 1M9 15.5c1.6 1.4 4.4 1.4 6 0" />
    </Svg>
  );
}

/** Fingerprint ridges, used on fingerprint devices. */
function FingerprintGlyph({ color, size = 46 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      <Circle cx="12" cy="12" r="2" />
      <Path d="M12 6a6 6 0 0 0-6 6c0 1.2.2 2.3.6 3.3" />
      <Path d="M12 6a6 6 0 0 1 6 6c0 1.6-.3 3.2-.9 4.6" />
      <Path d="M12 9.5a2.5 2.5 0 0 0-2.5 2.5c0 2.2.4 4.3 1.2 6.2" />
      <Path d="M14.5 12c0 2.6-.4 5-1.2 7.3" />
      <Path d="M3.5 12A8.5 8.5 0 0 1 12 3.5" />
    </Svg>
  );
}

/**
 * Why the last unlock attempt didn't sign the employee in.
 *
 * `stale` is the one that can't be retried: the keychain item was invalidated
 * when the device's biometric set changed, so the saved sign-in is gone even
 * though the enrolment record isn't.
 */
type Failure = 'cancelled' | 'failed' | 'lockout' | 'unavailable' | 'stale';

/**
 * What the screen is *doing*, tracked separately from why it last failed.
 *
 * These were one state before, which is how a failed sign-in could leave the
 * screen stuck: the API call ran while the screen still called itself
 * "prompting", so the busy flag never cleared and Try Again stayed hidden.
 */
type Phase = 'checking' | 'prompting' | 'signing-in' | 'idle';

export default function UnlockScreen() {
  const theme = useTheme();
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [name, setName] = useState<string>();
  const [phase, setPhase] = useState<Phase>('checking');
  const [failure, setFailure] = useState<Failure | null>(null);

  /** Guards against a second prompt while one is already on screen. */
  const busyRef = useRef(false);

  const signIn = useSignIn((session) => {
    router.replace(session.companies.length > 1 ? '/companies' : '/home');
  });

  const attempt = useCallback(async (label: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setFailure(null);
    setPhase('prompting');

    const result = await verify(`Sign in to Olympic Paycheck with ${label}`);

    if (!result.ok) {
      busyRef.current = false;
      setPhase('idle');
      setFailure(result.reason);
      return;
    }

    // Verification is done; reading the credential may prompt again (the item
    // is OS-gated) but the biometric phase is over either way.
    const stored = await readCredential();
    busyRef.current = false;

    if (!stored.ok) {
      // `missing` means the enrolment vanished between screens — nothing to
      // unlock and nothing to explain, so just hand over to the form. Only a
      // `locked` vault warrants staying here to say what happened.
      if (stored.reason === 'missing') {
        router.replace('/');
        return;
      }
      setPhase('idle');
      setFailure('stale');
      return;
    }

    setPhase('signing-in');
    signIn.mutate(
      { email: stored.credential.email, ssnLast4: stored.credential.ssnLast4 },
      // Leaving the signing-in phase on failure is what restores Try Again.
      // The error copy itself comes from the mutation, not from `failure`.
      { onSettled: () => setPhase('idle') },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prompt once, as soon as the screen opens.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const cap = await getCapability();
      setCapability(cap);
      // Greet by name without touching the secret: the name lives in the
      // ungated enrolment record precisely so this read is safe pre-auth.
      setName((await readEnrollment())?.name);
      // Nothing to unlock with. `/` only bounces back here when biometrics are
      // available, so this hands over to the form rather than looping.
      if (cap.available) attempt(cap.label);
      else router.replace('/');
    })();
  }, [attempt]);

  /**
   * Fall back to the normal form without erasing the saved credential.
   *
   * The flag matters: `/` redirects straight back here whenever a credential
   * is enrolled, so navigating there plainly bounced the employee into a
   * prompt loop. `manual=1` tells the login screen this arrival was deliberate.
   */
  const useEmailInstead = () => router.replace(MANUAL_LOGIN_PARAMS);

  /** Forget this device entirely, then go to the form. */
  const forgetDevice = async () => {
    await clearCredential();
    router.replace('/');
  };

  const label = capability?.label ?? 'Biometrics';
  const busy = phase === 'checking' || phase === 'prompting' || phase === 'signing-in';

  const headline =
    phase === 'signing-in'
      ? 'Signing you in…'
      : signIn.isError
        ? 'We couldn’t sign you in'
        : failure === 'failed'
          ? `${label} didn’t match`
          : failure === 'lockout'
            ? `${label} is locked`
            : failure === 'unavailable'
              ? `${label} isn’t available`
              : failure === 'stale'
                ? 'Saved sign-in expired'
                : failure === 'cancelled'
                  ? 'Sign in to continue'
                  : capability?.kind === 'fingerprint'
                    ? 'Touch the sensor to sign in'
                    : 'Look at your phone to sign in';

  // Lockout and permission problems are fixable by the employee, so say how.
  const detail = signIn.isError
    ? messageFor(signIn.error)
    : failure === 'lockout'
      ? `Too many attempts. Lock your phone, unlock it with your passcode once to re-enable ${label}, then tap Try Again.`
      : failure === 'unavailable'
        ? `Turn ${label} on for this app in your phone’s Settings, or sign in with your email.`
        : failure === 'stale'
          ? `Your ${label} setup changed on this phone, so the saved sign-in was cleared for your security. Sign in with your email to set it up again.`
          : `${label} unlocks the sign-in saved on this device.`;

  // A stale keychain item cannot be re-read no matter how many times the
  // biometric passes, so offering "Try Again" would only waste the employee's
  // time. Everything else — cancellation, mismatch, lockout, an API failure
  // after a good scan — is worth another go.
  const canRetry = !busy && failure !== 'stale' && capability?.available !== false;

  return (
    <Screen>
      <View style={styles.container}>
        <Animated.View entering={FadeIn.duration(350)} style={styles.header}>
          <Logo size={104} />
          <Text style={[Type.caption, { color: theme.textSecondary, marginTop: Spacing.three }]}>Welcome back</Text>
          {!!name && <Text style={[styles.name, { color: theme.ink }]}>{name}</Text>}
        </Animated.View>

        <View style={[styles.badge, { borderColor: theme.brand, backgroundColor: theme.sketchTint }]}>
          {capability?.kind === 'fingerprint' ? (
            <FingerprintGlyph color={theme.brand} />
          ) : (
            <FaceGlyph color={theme.brand} />
          )}
        </View>

        <Text style={[Type.row, { color: theme.ink, marginTop: Spacing.four, textAlign: 'center' }]}>{headline}</Text>

        <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 8, textAlign: 'center', maxWidth: 280 }]}>
          {detail}
        </Text>

        {canRetry && (
          <Button
            title="Try Again"
            onPress={() => attempt(label)}
            style={{ alignSelf: 'stretch', marginTop: Spacing.four }}
          />
        )}

        <View style={styles.actions}>
          <Pressable onPress={useEmailInstead} hitSlop={8} accessibilityRole="button" disabled={busy}>
            <Text style={[Type.callout, { color: busy ? theme.faint : theme.brand }]}>Use email instead</Text>
          </Pressable>
          <Pressable onPress={forgetDevice} hitSlop={8} accessibilityRole="button" disabled={busy}>
            <Text style={[Type.caption, { color: theme.faint }]}>Forget this device</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  header: { alignItems: 'center' },
  name: { fontSize: 24, fontWeight: '600', marginTop: 2 },
  badge: {
    width: 92,
    height: 92,
    borderRadius: Radius.xl,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.five,
  },
  actions: { marginTop: Spacing.five, alignItems: 'center', gap: Spacing.three },
});
