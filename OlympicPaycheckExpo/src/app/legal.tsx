import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PageTitle } from '@/components/app-bar';
import { Card, Screen } from '@/components/ui';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Privacy Policy / Terms of Use.
 *
 * NOTE: this copy is a DRAFT written from what the app actually does. It has
 * not been reviewed by Olympic Payroll or their counsel. Before store
 * submission it must be replaced with (or approved as) the company's official
 * text — app stores reject apps whose privacy policy doesn't match behaviour.
 */

type Section = { heading: string; body: string };

const PRIVACY: Section[] = [
  {
    heading: 'What this app shows',
    body: 'Olympic Paycheck lets you view your own pay information — your latest paycheck, previous paychecks, year-to-date totals, and the earnings, taxes and deductions that make up each pay stub. It is available to employees of Olympic Payroll clients enrolled in Paperless Payroll.',
  },
  {
    heading: 'Information we use',
    body: 'To sign you in we use your email address and the last four digits of your Social Security number. After repeated failed attempts we may ask for your full Social Security number to confirm your identity. Your payroll information is retrieved from Olympic Payroll each time you open the app.',
  },
  {
    heading: 'What is stored on your device',
    body: 'Your Social Security number is not stored on your device. If you choose to remember your email address, only the email is saved. If you turn on Face ID, Touch ID or fingerprint sign-in, your sign-in details are held in your device’s encrypted keychain and released only after a successful biometric check. You can erase them at any time from Profile, or by signing out.',
  },
  {
    heading: 'Sharing',
    body: 'Your payroll information is not sold and is not shared with third parties for advertising. It is exchanged only between this app and Olympic Payroll in order to show you your own pay records.',
  },
  {
    heading: 'Your photo',
    body: 'If you add a profile photo, it is sent to Olympic Payroll and shown with your payroll record in this app. You can replace it at any time.',
  },
  {
    heading: 'Questions',
    body: 'For questions about your pay records or this policy, contact Olympic Payroll directly.',
  },
];

const TERMS: Section[] = [
  {
    heading: 'Who can use this app',
    body: 'Olympic Paycheck is for active, paid employees of existing Olympic Payroll clients that have signed up for Paperless Payroll. Access is personal to you — do not share your sign-in details with anyone.',
  },
  {
    heading: 'Keeping your account secure',
    body: 'You are responsible for keeping your device and sign-in details secure. If you enable biometric sign-in, anyone whose fingerprint or face is enrolled on your device may be able to open the app. Sign out or turn off biometric sign-in if your device is shared.',
  },
  {
    heading: 'Accuracy of your pay information',
    body: 'Pay information is provided by Olympic Payroll and their client, your employer. Please review it for accuracy and report anything that looks wrong to your employer or to Olympic Payroll promptly. This app displays your records; it does not process payroll or change your pay.',
  },
  {
    heading: 'Availability',
    body: 'We aim to keep the app available at all times, but access may be interrupted for maintenance or reasons outside our control. Pay information may be unavailable if your employer’s payroll has not yet been processed.',
  },
  {
    heading: 'Changes',
    body: 'These terms may be updated. Continuing to use the app after an update means you accept the revised terms.',
  },
];

export default function LegalScreen() {
  const theme = useTheme();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const isTerms = doc === 'terms';
  const sections = isTerms ? TERMS : PRIVACY;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle title={isTerms ? 'Terms of Use' : 'Privacy Policy'} onBack={() => router.back()} />

        <View style={styles.body}>
          {sections.map((s) => (
            <View key={s.heading} style={styles.section}>
              <Text style={[Type.headline, { color: theme.ink }]}>{s.heading}</Text>
              <Text style={[Type.body, { color: theme.textSecondary, marginTop: 6 }]}>{s.body}</Text>
            </View>
          ))}

          <Card style={[styles.notice, { backgroundColor: theme.rowFill, borderColor: theme.line }]}>
            <Text style={[Type.caption, { color: theme.textSecondary }]}>
              Draft wording pending review by Olympic Payroll. The final text will be supplied by the company before
              release.
            </Text>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six },
  body: { paddingHorizontal: Spacing.three, gap: Spacing.four, marginTop: Spacing.two },
  section: { gap: 2 },
  notice: { padding: Spacing.three, marginTop: Spacing.two },
});
