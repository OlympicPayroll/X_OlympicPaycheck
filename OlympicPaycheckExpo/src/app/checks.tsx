import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useChecksForDate } from '@/api/queries';
import { FamilyHeader, PageTitle } from '@/components/app-bar';
import { ChevronRight } from '@/components/icons';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Card } from '@/components/ui';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usd } from '@/lib/format';

/**
 * A pay period can contain more than one check (e.g. a regular check plus a
 * bonus). This lists them so the employee can open each stub individually.
 */
export default function ChecksScreen() {
  const theme = useTheme();
  const { date, label } = useLocalSearchParams<{ date?: string; label?: string }>();
  const checks = useChecksForDate(date);

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground }}>
      <FamilyHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle title="Checks" onBack={() => router.back()} />

        <Text style={[Type.body, { color: theme.textSecondary, paddingHorizontal: Spacing.three }]}>
          {label ? `${label} · ` : ''}This pay period includes more than one check.
        </Text>

        <View style={styles.wrap}>
          {checks.isPending && <ListSkeleton rows={2} />}
          {checks.isError && <ErrorState error={checks.error} onRetry={() => checks.refetch()} />}

          {checks.data?.length === 0 && (
            <EmptyState
              title="No checks to show"
              message="We couldn’t find the individual checks for this pay period. Please call Olympic Payroll."
            />
          )}

          {!!checks.data?.length && (
            <Animated.View entering={FadeInDown.duration(300).delay(60)}>
              <Card style={{ overflow: 'hidden' }}>
                {checks.data.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: theme.line }]} />}
                    <Pressable
                      onPress={() => router.push({ pathname: '/stub', params: { id: c.id } })}
                      accessibilityRole="button"
                      accessible
                      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.rowFill }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[Type.row, { color: theme.ink, fontSize: 16.5 }]}>Check {i + 1}</Text>
                        <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 1 }]}>{c.method}</Text>
                      </View>
                      <Text style={[styles.amount, { color: theme.money }]}>{usd(c.net)}</Text>
                      <ChevronRight color={theme.faint} size={18} />
                    </Pressable>
                  </View>
                ))}
              </Card>
            </Animated.View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six },
  wrap: { marginTop: Spacing.three, paddingHorizontal: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: Spacing.three, gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  amount: { fontSize: 15.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
