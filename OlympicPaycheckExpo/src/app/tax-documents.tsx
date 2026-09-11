import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTaxDocuments } from '@/api/queries';
import type { TaxDocument } from '@/api/types';
import { FamilyHeader, PageTitle } from '@/components/app-bar';
import { ChevronRight } from '@/components/icons';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Card } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/**
 * Annual Tax Documents: the employee's W-2s, newest first, from the employer
 * whose payroll they are viewing. Named after the same section of Olympic
 * Employee Access, so employees who use both apps find it where they expect.
 */
export default function TaxDocumentsScreen() {
  const theme = useTheme();
  const { company } = useSession();
  const documents = useTaxDocuments();

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground }}>
      <FamilyHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle title="Tax Documents" onBack={() => router.back()} />

        <Text style={[Type.body, { color: theme.textSecondary, paddingHorizontal: Spacing.three }]}>
          Your W-2s{company ? ` from ${company.name}` : ''}, for filing your tax return. Each year’s W-2 is issued by
          January 31 of the year after.
        </Text>

        <View style={styles.wrap}>
          {documents.isPending && <ListSkeleton rows={3} />}
          {documents.isError && <ErrorState error={documents.error} onRetry={() => documents.refetch()} />}

          {documents.data?.length === 0 && (
            <EmptyState
              title="No tax documents yet"
              message="Your W-2 will appear here once your employer issues it, by January 31 of the year after."
            />
          )}

          {!!documents.data?.length && (
            <Animated.View entering={FadeInDown.duration(300).delay(60)}>
              <Card style={{ overflow: 'hidden' }}>
                {documents.data.map((doc, i) => (
                  <View key={doc.id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: theme.line }]} />}
                    <DocumentRow doc={doc} />
                  </View>
                ))}
              </Card>

              <Text style={[Type.caption, { color: theme.faint, marginTop: Spacing.three }]}>
                Olympic Payroll prepares your W-2 for your employer. If your name, Social Security number or any amount
                looks wrong, contact your employer. Corrections are issued on Form W-2c.
              </Text>
            </Animated.View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function DocumentRow({ doc }: { doc: TaxDocument }) {
  const theme = useTheme();
  const title = `${doc.taxYear} Form ${doc.form}`;

  // Listed so the employee knows it's coming and when, but there's nothing to open yet.
  if (doc.status === 'pending') {
    return (
      <View style={styles.row} accessible accessibilityLabel={`${title}, not issued yet. Ready by ${doc.date}.`}>
        <View style={{ flex: 1 }}>
          <Text style={[Type.row, { color: theme.textSecondary, fontSize: 16.5 }]}>{title}</Text>
          <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 1 }]}>Ready by {doc.date}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: theme.sketchTint }]}>
          <Text style={[styles.pillText, { color: theme.brand }]}>PENDING</Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/w2', params: { id: doc.id } })}
      accessibilityRole="button"
      accessible
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.rowFill }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[Type.row, { color: theme.ink, fontSize: 16.5 }]}>{title}</Text>
        <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 1 }]}>Issued {doc.date}</Text>
      </View>
      <ChevronRight color={theme.faint} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six },
  wrap: { marginTop: Spacing.three, paddingHorizontal: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: Spacing.three, gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
});
