import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { PageTitle } from '@/components/app-bar';
import { ChevronRight } from '@/components/icons';
import { Card, Screen } from '@/components/ui';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { displayName } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Company } from '@/api/types';

/**
 * Employees paid by more than one Olympic Payroll client pick which employer's
 * payroll to view. Single-company employees never see this screen.
 */
export default function CompaniesScreen() {
  const theme = useTheme();
  const { session, selectCompany } = useSession();

  const choose = (company: Company) => {
    selectCompany(company);
    router.replace('/home');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <PageTitle title="Choose employer" />

        <Text style={[Type.body, { color: theme.textSecondary, paddingHorizontal: Spacing.three }]}>
          {session ? `${displayName(session.employee.fullName)}, you're` : "You're"} paid by more than one company.
          Pick the payroll you want to view.
        </Text>

        <View style={styles.list}>
          {session?.companies.map((c, i) => (
            <Animated.View key={c.id} entering={FadeInDown.duration(280).delay(60 + i * 60)}>
              <Pressable onPress={() => choose(c)} accessibilityRole="button">
                <Card style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.row, { color: theme.ink }]}>{c.name}</Text>
                    <Text style={[Type.caption, { color: theme.textSecondary, marginTop: 2 }]}>
                      Employee #{c.employeeId}
                    </Text>
                  </View>
                  <ChevronRight color={theme.faint} />
                </Card>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six },
  list: { gap: 12, paddingHorizontal: Spacing.three, marginTop: Spacing.four },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: Spacing.three },
});
