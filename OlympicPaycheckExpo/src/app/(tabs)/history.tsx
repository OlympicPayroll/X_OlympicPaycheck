import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { usePaychecks, usePayYears } from '@/api/queries';
import { FamilyHeader, PageTitle } from '@/components/app-bar';
import { ChevronRight } from '@/components/icons';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '@/components/states';
import { Card } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usd } from '@/lib/format';

export default function HistoryScreen() {
  const theme = useTheme();
  const years = usePayYears();
  const [year, setYear] = useState<number>();

  // Default to the most recent year once the list arrives.
  useEffect(() => {
    if (year === undefined && years.data?.length) setYear(years.data[0]);
  }, [years.data, year]);

  const paychecks = usePaychecks(year);

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground }}>
      <FamilyHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle title="Previous Paychecks" />

        <View style={styles.chips}>
          {years.isPending && [0, 1, 2, 3].map((i) => <Skeleton key={i} height={38} width={72} radius={Radius.pill} />)}
          {years.data?.map((y) => {
            const active = y === year;
            return (
              <Pressable
                key={y}
                onPress={() => setYear(y)}
                accessibilityRole="button"
                accessibilityState={active ? { selected: true } : {}}
                style={[styles.chip, { backgroundColor: active ? theme.brandSurface : theme.sketchTint }]}
              >
                <Text style={[Type.callout, { color: active ? theme.onBrand : theme.ink }]}>{y}</Text>
              </Pressable>
            );
          })}
        </View>

        {years.isError && <ErrorState error={years.error} onRetry={() => years.refetch()} />}

        {!years.isError && (
          <View style={styles.listWrap}>
            {paychecks.isPending && <ListSkeleton rows={6} />}

            {paychecks.isError && <ErrorState error={paychecks.error} onRetry={() => paychecks.refetch()} />}

            {paychecks.data?.length === 0 && (
              <EmptyState title="No paychecks in this year" message="Pick another year to see earlier payroll." />
            )}

            {!!paychecks.data?.length && (
              <Animated.View entering={FadeInDown.duration(300).delay(60)}>
                <Card style={{ overflow: 'hidden' }}>
                  {paychecks.data.map((p, i) => (
                    <View key={p.id}>
                      {i > 0 && <View style={[styles.divider, { backgroundColor: theme.line }]} />}
                      <Pressable
                        onPress={() => {
                          // A period with several separate checks opens a list;
                          // combined checks open straight into a merged stub.
                          if (p.checkCount > 1 && !p.isCombined) {
                            router.push({ pathname: '/checks', params: { date: p.payDateIso, label: p.payDate } });
                          } else {
                            router.push({
                              pathname: '/stub',
                              params: {
                                id: p.id,
                                date: p.payDateIso,
                                combined: p.isCombined ? '1' : undefined,
                                sentId: p.sentId,
                              },
                            });
                          }
                        }}
                        accessibilityRole="button"
                        accessible
                        style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.rowFill }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[Type.row, { color: theme.ink, fontSize: 16.5 }]}>{p.payDate}</Text>
                          <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 1 }]}>
                            {p.method}
                            {p.checkCount > 1 ? ` · ${p.checkCount} ${p.isCombined ? 'combined' : 'checks'}` : ''}
                          </Text>
                        </View>
                        <View style={styles.amountWrap}>
                          <Text style={[styles.amount, { color: theme.money }]}>{usd(p.net)}</Text>
                          {p.isNew ? (
                            <View style={[styles.pill, { backgroundColor: theme.moneyTint }]}>
                              <Text style={[styles.pillText, { color: theme.money }]}>NEW</Text>
                            </View>
                          ) : (
                            <ChevronRight color={theme.faint} size={18} />
                          )}
                        </View>
                      </Pressable>
                    </View>
                  ))}
                </Card>
              </Animated.View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 140 },
  chips: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 4 },
  chip: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: Radius.pill },
  listWrap: { marginTop: Spacing.three, paddingHorizontal: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: Spacing.three, gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  amountWrap: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  amount: { fontSize: 15.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
});
