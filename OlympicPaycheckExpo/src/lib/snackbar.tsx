import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing, Type } from '@/constants/theme';

/**
 * A short message that pops up at the bottom of the screen, offers at most one
 * action, then goes away on its own.
 *
 * For news that needs no answer ("PDF saved to your phone"), where a dialog
 * would make the employee stop and tap before carrying on.
 */
export type SnackbarOptions = {
  message: string;
  action?: { label: string; onPress: () => void };
  /** How long it stays up: long enough to reach the action. */
  durationMs?: number;
};

type SnackbarApi = {
  show: (options: SnackbarOptions) => void;
  hide: () => void;
};

const DEFAULT_DURATION_MS = 7000;

const SnackbarContext = createContext<SnackbarApi | null>(null);

export function useSnackbar(): SnackbarApi {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error('useSnackbar must be used within a SnackbarProvider');
  return ctx;
}

/**
 * How long a message stays up, or null to keep it until it is used.
 *
 * Someone using a screen reader has to find the action by swiping, which takes
 * longer than the bar would last, so a bar with an action waits for them (as
 * Android's own snackbar does). Otherwise Android's "Time to take action"
 * accessibility setting can lengthen it.
 */
async function lifetime({ action, durationMs = DEFAULT_DURATION_MS }: SnackbarOptions): Promise<number | null> {
  try {
    if (action && (await AccessibilityInfo.isScreenReaderEnabled())) return null;
    const recommended = await AccessibilityInfo.getRecommendedTimeoutMillis(durationMs);
    return typeof recommended === 'number' && recommended > durationMs ? recommended : durationMs;
  } catch {
    return durationMs;
  }
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<(SnackbarOptions & { key: number }) | null>(null);
  const counter = useRef(0);

  const hide = useCallback(() => setCurrent(null), []);

  /** A newer message replaces the one on screen, and takes over its timer. */
  const show = useCallback((options: SnackbarOptions) => {
    counter.current += 1;
    setCurrent({ ...options, key: counter.current });
    // Android reads the bar out through its live region below; iOS has no
    // equivalent, so VoiceOver is told directly.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(options.message);
  }, []);

  useEffect(() => {
    if (!current) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void lifetime(current).then((ms) => {
      if (!live || ms === null) return;
      timer = setTimeout(() => setCurrent((now) => (now?.key === current.key ? null : now)), ms);
    });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [current]);

  const value = useMemo(() => ({ show, hide }), [show, hide]);

  const onAction = () => {
    const action = current?.action;
    hide();
    action?.onPress();
  };

  return (
    <SnackbarContext.Provider value={value}>
      {children}

      {current && (
        <Animated.View
          key={current.key}
          entering={FadeInDown.duration(220)}
          exiting={FadeOutDown.duration(180)}
          pointerEvents="box-none"
          style={[styles.wrap, { bottom: insets.bottom + Spacing.three }]}
        >
          <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {/* A screen reader can dismiss a bar that is waiting for them: the
                Dismiss action on Android, the escape gesture on iOS. */}
            <View
              style={styles.message}
              accessible
              accessibilityLabel={current.message}
              accessibilityActions={[{ name: 'dismiss', label: 'Dismiss' }]}
              onAccessibilityAction={hide}
              onAccessibilityEscape={hide}
            >
              <Text style={[Type.body, styles.messageText]} numberOfLines={2}>
                {current.message}
              </Text>
            </View>
            {current.action && (
              <Pressable
                onPress={onAction}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.actionText}>{current.action.label}</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}
    </SnackbarContext.Provider>
  );
}

// Deliberately theme-independent, like the demo banner: a dark bar reads as
// "passing notice" against both the light and the dark app.
const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.three, right: Spacing.three },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 52,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: '#1F2933',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  message: { flex: 1 },
  messageText: { color: '#FFFFFF' },
  action: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.sm },
  actionText: { color: '#8CCBF5', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
});
