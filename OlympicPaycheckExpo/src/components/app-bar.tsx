import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePhoto } from '@/api/queries';
import { DemoBanner } from '@/components/demo-banner';
import { ChevronLeft } from '@/components/icons';
import { Logo } from '@/components/logo';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { displayName, initials } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * Family identity header, echoing Olympic Employee Access: a chunky flat-blue
 * bar with the employee's avatar and first name — the page title does NOT live
 * here (see PageTitle below). Fills behind the status bar itself.
 */
export function FamilyHeader() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, company } = useSession();
  const { data: photoUri } = usePhoto();

  const name = session ? displayName(session.employee.fullName) : '';

  return (
    <>
      <View
        style={{ backgroundColor: theme.brandSurface, paddingTop: insets.top }}
        // The bar is one identity block; a screen reader should read it as
        // "Sarah, Cascade Coffee Roasters", not three stray fragments.
        accessible
        accessibilityRole="header"
        accessibilityLabel={[session?.employee.firstName, company?.name].filter(Boolean).join(', ')}
      >
        <StatusBar style="light" />
        <View style={styles.bar}>
          <View style={styles.avatar}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <Text style={[styles.avatarText, { color: theme.onBrand }]}>{initials(name)}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: theme.onBrand }]} numberOfLines={1}>
              {session?.employee.firstName ?? ' '}
            </Text>
            <Text style={[styles.sub, { color: theme.onBrandMuted }]} numberOfLines={1}>
              {company?.name ?? ''}
            </Text>
          </View>
          <Logo size={60} />
        </View>
      </View>

      <DemoBanner />
    </>
  );
}

/**
 * Large, regular-weight page title in the content area, with the family's
 * light-blue rounded back button when the screen can go back.
 */
export function PageTitle({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  const theme = useTheme();

  return (
    <View style={styles.titleRow}>
      {onBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={({ pressed }) => [styles.backBtn, { backgroundColor: theme.brandLight }, pressed && { opacity: 0.7 }]}
        >
          <ChevronLeft color="#FFFFFF" size={24} />
        </Pressable>
      )}
      <Text style={[Type.pageTitle, { color: theme.ink, flex: 1 }]} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function TitleIconButton({ children, onPress, label }: { children: ReactNode; onPress?: () => void; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.sketchTint }, pressed && { opacity: 0.7 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 92,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: { fontSize: 17, fontWeight: '700' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 26 },
  name: { fontSize: 22, fontWeight: '500', letterSpacing: 0.2 },
  // Colour comes from the theme (onBrandMuted) — a hardcoded translucent white
  // is unreadable on the lighter dark-mode brand.
  sub: { fontSize: 12.5, marginTop: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingTop: 20,
    paddingBottom: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
