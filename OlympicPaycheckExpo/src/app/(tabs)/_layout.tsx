import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Clock, Home, UserCircle } from '@/components/icons';
import { useTheme } from '@/hooks/use-theme';

const TAB_META = {
  home: { Icon: Home, label: 'Home' },
  history: { Icon: Clock, label: 'History' },
  profile: { Icon: UserCircle, label: 'Profile' },
} as const;

/**
 * Floating white pill bottom nav, echoing the Olympic Employee Access app:
 * rounded pill, soft shadow, icons with a small dot under the active tab.
 */
function PillTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 10) + 8 }]}>
      <View style={[styles.pill, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {state.routes.map((route, i) => {
          const meta = TAB_META[route.name as keyof typeof TAB_META];
          if (!meta) return null;
          const focused = state.index === i;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={meta.label}
              style={styles.item}
              hitSlop={10}
            >
              <View style={[styles.iconHalo, focused && { backgroundColor: theme.sketchTint }]}>
                <meta.Icon color={focused ? theme.brand : theme.ink} size={26} />
              </View>
              <View style={[styles.dot, { backgroundColor: focused ? theme.brand : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <PillTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 28 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#4A90CE',
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  item: { alignItems: 'center', gap: 2 },
  iconHalo: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
