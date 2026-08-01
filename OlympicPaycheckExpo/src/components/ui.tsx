import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Full-bleed screen with the app "ground" background + safe-area insets. */
export function Screen({
  children,
  edges = ['top', 'bottom'],
  style,
  ...rest
}: ViewProps & { children?: ReactNode; edges?: Edge[] }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: theme.ground }, style]} {...rest}>
      {children}
    </SafeAreaView>
  );
}

/** White surface card with hairline border. */
export function Card({ children, style, ...rest }: ViewProps & { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderColor: theme.cardEdge,
          borderWidth: 1,
          borderRadius: Radius.md,
        },
        styles.cardShadow,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

type ButtonProps = PressableProps & {
  title: string;
  variant?: 'primary' | 'subtle';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ title, variant = 'primary', loading, icon, style, disabled, ...rest }: ButtonProps) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        isPrimary && [styles.buttonShadow, { shadowColor: theme.brand }],
        {
          // brandSurface, not brand: this is a filled background carrying
          // `onBrand` text, and in dark mode the two are different colours.
          backgroundColor: isPrimary ? theme.brandSurface : theme.brandTint,
          opacity: disabled ? 0.5 : state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? theme.onBrand : theme.brand} />
      ) : (
        <>
          {icon}
          <Text style={[styles.buttonText, { color: isPrimary ? theme.onBrand : theme.brand }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardShadow: {
    shadowColor: '#4A90CE',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  button: {
    // Grows with the OS text size instead of clipping the label.
    minHeight: 50,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  buttonShadow: {
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  buttonText: {
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
