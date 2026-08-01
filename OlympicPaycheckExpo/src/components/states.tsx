import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { messageFor } from '@/api/types';

/** Shimmer-less skeleton block — calm, matches the card system. */
export function Skeleton({ height, width, radius = Radius.sm }: { height: number; width?: number | `${number}%`; radius?: number }) {
  const theme = useTheme();
  return <View style={{ height, width: width ?? '100%', borderRadius: radius, backgroundColor: theme.rowFill }} />;
}

/** Placeholder for the dashboard's latest-paycheck card. */
export function CardSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardEdge }]}>
      <Skeleton height={18} width="55%" />
      <View style={{ height: 10 }} />
      <Skeleton height={13} width="40%" />
      <View style={{ height: 20 }} />
      <Skeleton height={34} width="65%" />
    </View>
  );
}

/** Placeholder for list screens. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={{ gap: 22, paddingVertical: Spacing.two }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.row}>
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={16} width="45%" />
            <Skeleton height={12} width="30%" />
          </View>
          <Skeleton height={16} width={78} />
        </View>
      ))}
    </View>
  );
}

/** Error state with a retry affordance. Never shows raw error text. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    // Announced as soon as it replaces the loading skeleton, so a screen-reader
    // user isn't left waiting on content that already failed.
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.center}>
      <Text style={[Type.headline, { color: theme.ink, textAlign: 'center' }]}>We couldn’t load this</Text>
      <Text style={[Type.body, { color: theme.textSecondary, textAlign: 'center', marginTop: 8 }]}>
        {messageFor(error)}
      </Text>
      {onRetry && <Button title="Try Again" variant="subtle" onPress={onRetry} style={{ marginTop: Spacing.four, alignSelf: 'stretch' }} />}
    </View>
  );
}

/** Empty state — used when a year genuinely has no payroll. */
export function EmptyState({ title, message }: { title: string; message?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <Text style={[Type.headline, { color: theme.ink, textAlign: 'center' }]}>{title}</Text>
      {message && (
        <Text style={[Type.body, { color: theme.textSecondary, textAlign: 'center', marginTop: 8 }]}>{message}</Text>
      )}
    </View>
  );
}

/** Small inline spinner for in-place refreshes. */
export function InlineSpinner() {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: Spacing.five, alignItems: 'center' }}>
      <ActivityIndicator color={theme.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
});
