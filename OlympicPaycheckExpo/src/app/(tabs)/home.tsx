import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useLatestPaycheck } from '@/api/queries';
import { FamilyHeader, PageTitle } from '@/components/app-bar';
import { ChevronRight } from '@/components/icons';
import { Illustration, type IllustrationName } from '@/components/illustrations';
import { CardSkeleton, ErrorState } from '@/components/states';
import { Card } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usd } from '@/lib/format';
import { openPaycheck } from '@/lib/routes';

export default function HomeScreen() {
  const theme = useTheme();
  const latest = useLatestPaycheck();

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground }}>
      <FamilyHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View entering={FadeInDown.duration(300)}>
          <PageTitle title="Dashboard" />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(70)} style={styles.latestWrap}>
          {latest.isPending && <CardSkeleton />}

          {latest.isError && <ErrorState error={latest.error} onRetry={() => latest.refetch()} />}

          {latest.data && (
            <Pressable
              // Shared with History: a latest period holding several separate
              // checks must open the check list, not an arbitrary one of them.
              onPress={() => openPaycheck(latest.data)}
              accessibilityRole="button"
              // Read as one item — "Latest paycheck, new, pay date …, $1,755.02"
              // — instead of five unconnected fragments.
              accessible
            >
              <Card style={styles.latest}>
                <View style={styles.rowBetween}>
                  <Text style={[Type.headline, { color: theme.ink }]}>Latest Paycheck</Text>
                  {latest.data.isNew && (
                    <View style={[styles.pill, { backgroundColor: theme.moneyTint }]}>
                      <Text style={[styles.pillText, { color: theme.money }]}>NEW</Text>
                    </View>
                  )}
                </View>
                <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 4 }]}>
                  Pay date · {latest.data.payDate}
                  {latest.data.checkCount > 1
                    ? ` · ${latest.data.checkCount} ${latest.data.isCombined ? 'combined' : 'checks'}`
                    : ''}
                </Text>
                <View style={[styles.rowBetween, { marginTop: Spacing.three, alignItems: 'flex-end' }]}>
                  <View>
                    <Text style={[styles.bigNet, { color: theme.money }]}>{usd(latest.data.net)}</Text>
                    <Text style={[Type.overline, { color: theme.faint, marginTop: 6 }]}>NET PAY</Text>
                  </View>
                  <ChevronRight color={theme.faint} size={22} />
                </View>
              </Card>
            </Pressable>
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(140)} style={{ marginTop: Spacing.two }}>
          <FeatureRow illustration="receipt" title="Previous Paychecks" onPress={() => router.push('/history')} />
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          <FeatureRow
            illustration="taxes"
            title="Annual Tax Documents"
            onPress={() => router.push('/tax-documents')}
          />
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          <FeatureRow illustration="camera" title="Profile Photo" onPress={() => router.push('/profile')} />
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/** Large illustrated list row on white with hairline dividers — the family's dashboard list style. */
function FeatureRow({
  illustration,
  title,
  onPress,
}: {
  illustration: IllustrationName;
  title: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.featureRow, pressed && { backgroundColor: theme.rowFill }]}
    >
      <Illustration name={illustration} size={58} />
      <Text style={[Type.row, { color: theme.ink, flex: 1 }]}>{title}</Text>
      <ChevronRight color={theme.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 140 },
  latestWrap: { paddingHorizontal: Spacing.three, marginTop: Spacing.two },
  latest: { padding: Spacing.three },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bigNet: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
    paddingHorizontal: Spacing.three,
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
});
