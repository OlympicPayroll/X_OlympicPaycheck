import { StyleSheet, Text, View } from 'react-native';

import { IS_MOCK_BACKEND } from '@/api/client';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Marks the app while it runs on fixtures instead of a real payroll backend.
 *
 * Without this, the earnings, deductions and net pay on screen are plausible
 * enough to be mistaken for a real employee's wages — which is the last
 * confusion a payroll product can afford in a review build.
 *
 * It removes itself: `IS_MOCK_BACKEND` goes false the moment `getApi()` returns
 * a real backend, so nobody has to remember to strip this before shipping.
 */
export function DemoBanner() {
  const theme = useTheme();

  if (!IS_MOCK_BACKEND) return null;

  return (
    <View style={[styles.bar, { backgroundColor: theme.warning }]} accessibilityRole="alert">
      <Text style={styles.label} numberOfLines={1}>
        SAMPLE DATA · NOT REAL PAYROLL
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingVertical: 5,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  // Deliberately theme-independent: `warning` is bright amber in both schemes,
  // so the label stays dark in dark mode rather than following `text`.
  label: {
    color: '#2B2000',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
});
