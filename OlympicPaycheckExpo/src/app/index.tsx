import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useSignIn } from '@/api/queries';
import { ApiError, messageFor, type Session } from '@/api/types';
import { DemoBanner } from '@/components/demo-banner';
import { Logo } from '@/components/logo';
import { Button, Screen } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getCapability,
  hasSavedCredential,
  saveCredential,
  type BiometricCapability,
} from '@/lib/biometrics';
import { useDialog } from '@/lib/dialog';
import { displayName } from '@/lib/format';
import { clearRememberedEmail, getRememberedEmail, setRememberedEmail } from '@/lib/prefs';

/** Failed last-4 attempts before we ask for the full SSN (matches the legacy app). */
const ATTEMPTS_BEFORE_FULL_SSN = 2;
/** Failed full-SSN attempts before the form locks. */
const MAX_FULL_SSN_ATTEMPTS = 3;

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h >= 6 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  if (h >= 18 && h < 23) return 'Good evening';
  return 'Good night';
}

/** Format digits as XXX-XX-XXXX while typing. */
function formatSsn(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function BiometricGlyph({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <Path d="M9 10v1M15 10v1M9 15c1.5 1.2 4.5 1.2 6 0" />
    </Svg>
  );
}

export default function LoginScreen() {
  const theme = useTheme();
  const { confirm } = useDialog();
  const hello = useMemo(() => greeting(), []);

  /**
   * Set when the employee chose "Use email instead" on the unlock screen.
   *
   * Without it this screen sends every enrolled device straight back to
   * `/unlock`, which re-fires the biometric prompt — so the advertised fallback
   * looped instead of reaching the form. Read once on mount: a later re-render
   * must not resurrect the redirect while they are mid-way through typing.
   */
  const params = useLocalSearchParams<{ manual?: string }>();
  const manualMode = useRef(params.manual === '1').current;

  const [email, setEmail] = useState('');
  const [ssn, setSsn] = useState('');
  const [fullSsn, setFullSsn] = useState('');
  const [remember, setRemember] = useState(true);
  const [focused, setFocused] = useState<'email' | 'ssn' | null>(null);
  const [validation, setValidation] = useState<string | null>(null);

  /** Escalation state, mirroring the legacy app's retry behaviour. */
  const [needsFullSsn, setNeedsFullSsn] = useState(false);
  const [locked, setLocked] = useState(false);
  const attempts = useRef({ last4: 0, full: 0 });

  const [checkingDevice, setCheckingDevice] = useState(true);
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const credentials = useRef<{ email: string; ssnLast4: string }>({ email: '', ssnLast4: '' });

  // Hand off to biometric unlock if this device has a saved sign-in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [enrolled, cap, savedEmail] = await Promise.all([
        hasSavedCredential(),
        getCapability(),
        getRememberedEmail(),
      ]);
      if (cancelled) return;
      setCapability(cap);
      if (enrolled && cap.available && !manualMode) {
        router.replace('/unlock');
        return;
      }
      if (savedEmail) setEmail(savedEmail);
      else setRemember(false);
      setCheckingDevice(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [manualMode]);

  /** After signing in, offer to enable biometrics for next time. */
  const offerBiometrics = async (session: Session) => {
    if (!capability?.available) return;
    if (await hasSavedCredential()) return;

    const ok = await confirm({
      title: `Enable ${capability.label}?`,
      message: `Use ${capability.label} to sign in next time instead of typing your email and SSN.`,
      confirmText: 'Enable',
      cancelText: 'Not now',
    });
    if (!ok) return;

    const result = await saveCredential(credentials.current, {
      name: displayName(session.employee.fullName),
    });
    // Dismissing the phone's own prompt is a choice, not a failure, so it gets
    // no message. A real failure does: otherwise the faster sign-in promised a
    // moment ago would never arrive, with no explanation.
    if (result === 'failed') {
      await confirm({
        title: `${capability.label} couldn’t be set up`,
        message: `Your phone wouldn’t store the sign-in securely. To try again, sign out and sign back in. Signing in with your email still works.`,
        confirmText: 'OK',
        cancelText: 'Close',
      });
    }
  };

  const signIn = useSignIn(async (session) => {
    await (remember ? setRememberedEmail(credentials.current.email) : clearRememberedEmail());
    await offerBiometrics(session);
    router.replace(session.companies.length > 1 ? '/companies' : '/home');
  });

  // Escalate to the full SSN after repeated mismatches; lock after too many.
  useEffect(() => {
    if (!signIn.isError) return;
    const isSsnError = signIn.error instanceof ApiError && signIn.error.code === 'INVALID_SSN';
    if (!isSsnError) return;

    if (needsFullSsn) {
      attempts.current.full += 1;
      if (attempts.current.full >= MAX_FULL_SSN_ATTEMPTS) setLocked(true);
    } else {
      attempts.current.last4 += 1;
      if (attempts.current.last4 >= ATTEMPTS_BEFORE_FULL_SSN) {
        setNeedsFullSsn(true);
        setSsn('');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signIn.isError, signIn.error]);

  const onSignIn = () => {
    setValidation(null);
    signIn.reset();
    if (!email.trim()) return setValidation('Please enter your email address.');

    if (needsFullSsn) {
      const digits = fullSsn.replace(/\D/g, '');
      if (digits.length !== 9) return setValidation('Enter all 9 digits of your Social Security number.');
      credentials.current = { email: email.trim(), ssnLast4: digits.slice(-4) };
      signIn.mutate({ email: email.trim(), ssnFull: digits });
      return;
    }

    if (ssn.length !== 4) return setValidation('Enter the last 4 digits of your SSN.');
    credentials.current = { email: email.trim(), ssnLast4: ssn };
    signIn.mutate({ email: email.trim(), ssnLast4: ssn });
  };

  /** Start over after a lockout. */
  const reset = () => {
    attempts.current = { last4: 0, full: 0 };
    setLocked(false);
    setNeedsFullSsn(false);
    setSsn('');
    setFullSsn('');
    setValidation(null);
    signIn.reset();
  };

  // Once we've escalated, a mismatch is against the full 9 digits — the shared
  // "last 4 digits" copy would point the employee at the wrong field.
  const isSsnMismatch = signIn.error instanceof ApiError && signIn.error.code === 'INVALID_SSN';
  const serverError = signIn.isError
    ? needsFullSsn && isSsnMismatch
      ? 'That doesn’t match the Social Security number on your payroll record. Try again.'
      : messageFor(signIn.error)
    : null;
  const error = validation ?? serverError;
  const disabled = signIn.isPending || locked;

  const inputStyle = (field: 'email' | 'ssn') => [
    styles.input,
    { backgroundColor: theme.surface, borderColor: focused === field ? theme.brand : theme.line, color: theme.text },
  ];

  if (checkingDevice) return <Screen />;

  return (
    <Screen>
      <DemoBanner />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Logo size={110} />
            <Text style={[styles.appName, { color: theme.ink }]}>Olympic Paycheck</Text>
            <Text style={[Type.body, { color: theme.textSecondary }]}>{hello}</Text>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>EMAIL</Text>
            <TextInput
              style={inputStyle('email')}
              accessibilityLabel="Email address"
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              placeholder="you@company.com"
              placeholderTextColor={theme.faint}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="email"
              editable={!disabled}
            />
          </View>

          {needsFullSsn ? (
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>FULL SOCIAL SECURITY NUMBER</Text>
              <TextInput
                style={inputStyle('ssn')}
                accessibilityLabel="Full Social Security number"
                accessibilityHint="All nine digits"
                value={fullSsn}
                onChangeText={(t) => setFullSsn(formatSsn(t))}
                onFocus={() => setFocused('ssn')}
                onBlur={() => setFocused(null)}
                placeholder="XXX-XX-XXXX"
                placeholderTextColor={theme.faint}
                keyboardType="number-pad"
                maxLength={11}
                editable={!disabled}
              />
              <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 7 }]}>
                For your security, we need your full Social Security number after repeated attempts.
              </Text>
            </View>
          ) : (
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>LAST 4 OF SSN</Text>
              <TextInput
                style={inputStyle('ssn')}
                accessibilityLabel="Last 4 digits of your Social Security number"
                value={ssn}
                onChangeText={(t) => setSsn(t.replace(/\D/g, '').slice(0, 4))}
                onFocus={() => setFocused('ssn')}
                onBlur={() => setFocused(null)}
                placeholder="••••"
                placeholderTextColor={theme.faint}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                editable={!disabled}
              />
            </View>
          )}

          <View style={styles.rememberRow}>
            <Text style={[Type.callout, { color: theme.ink }]}>Remember my email</Text>
            <Switch
              accessibilityLabel="Remember my email"
              value={remember}
              onValueChange={setRemember}
              disabled={disabled}
              trackColor={{ true: theme.moneyBright, false: theme.line }}
              thumbColor="#fff"
            />
          </View>

          {locked ? (
            <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.lockout, { backgroundColor: theme.rowFill }]}>
              <Text style={[Type.callout, { color: theme.danger, textAlign: 'center' }]}>
                Too many attempts
              </Text>
              <Text style={[Type.caption, { color: theme.textSecondary, textAlign: 'center', marginTop: 6 }]}>
                For your security we’ve stopped further attempts. Please call Olympic Payroll for help.
              </Text>
              <Button title="Start Over" variant="subtle" onPress={reset} style={{ alignSelf: 'stretch', marginTop: Spacing.three }} />
            </View>
          ) : (
            <>
              {error && (
                // Announced by the screen reader the moment it appears, rather
                // than only when the employee happens to swipe onto it.
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={[styles.error, { color: theme.danger }]}
                >
                  {error}
                </Text>
              )}
              <Button title="Sign In" onPress={onSignIn} loading={signIn.isPending} style={{ marginTop: Spacing.four }} />
            </>
          )}

          {capability?.available && !locked && (
            <View style={styles.biometricRow}>
              <BiometricGlyph color={theme.brand} />
              <Text style={[Type.caption, { color: theme.brand, fontWeight: '600' }]}>
                Turn on {capability.label} after you sign in
              </Text>
            </View>
          )}

          <View style={styles.legal}>
            <Pressable onPress={() => router.push('/legal?doc=privacy')} hitSlop={8} accessibilityRole="button">
              <Text style={[Type.caption, { color: theme.faint }]}>Privacy Policy</Text>
            </Pressable>
            <Text style={[Type.caption, { color: theme.faint }]}>·</Text>
            <Pressable onPress={() => router.push('/legal?doc=terms')} hitSlop={8} accessibilityRole="button">
              <Text style={[Type.caption, { color: theme.faint }]}>Terms of Use</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  header: { alignItems: 'center', gap: 4, marginBottom: Spacing.five },
  appName: { fontSize: 23, fontWeight: '700', letterSpacing: -0.4, marginTop: Spacing.three },
  field: { marginTop: Spacing.three },
  label: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6, marginBottom: 7 },
  input: {
    // minHeight, not height: at the largest accessibility text sizes a fixed
    // height clips what the employee typed.
    minHeight: 50,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15.5,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
  },
  error: { marginTop: Spacing.three, fontSize: 13.5, fontWeight: '600', textAlign: 'center' },
  lockout: { marginTop: Spacing.four, padding: Spacing.three, borderRadius: Radius.md },
  biometricRow: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.four },
  legal: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.five },
});
