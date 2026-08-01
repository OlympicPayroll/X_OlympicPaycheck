/**
 * Olympic Paycheck design tokens.
 *
 * Palette derived from the Olympic Payroll brand (brand blue #0269C2), with a
 * dedicated "money" green reserved ONLY for pay amounts, and torch-red used only
 * in the logo mark. Both light and dark themes expose the same keys so
 * `useTheme()` returns a complete palette in either scheme.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // Core neutrals: body copy and the page ground it sits on.
    text: '#171A1F',
    textSecondary: '#5A6472',
    background: '#F4F6F9', // app ground

    // Olympic brand tokens. Shades are chosen to clear WCAG AA against the
    // surfaces they actually sit on — see __tests__/contrast.test.ts, which
    // fails the build if a palette change drops below the threshold.
    brand: '#166CBD', // accent + text on light surfaces (5.37:1 on white)
    brandSurface: '#166CBD', // filled backgrounds behind `onBrand` text
    brandDeep: '#1568BC',
    brandLight: '#3E8FD4', // back-button squircle, active accents
    brandTint: '#E4F1FC',
    onBrand: '#FFFFFF',
    onBrandMuted: '#E3EEF9', // secondary text on a brand-filled bar (4.56:1)
    sketch: '#5B8FBE', // hand-drawn illustration line color
    sketchTint: '#E8F2FB', // soft blue "blob" behind illustrations
    money: '#087F5E', // pay figures — AA on white and on moneyTint
    moneyBright: '#05C596', // chips / accents
    moneyTint: '#E6F8F1',
    torch: '#E23B34', // logo mark only
    torchFlame: '#F6A623',
    surface: '#FFFFFF',
    ground: '#FFFFFF', // white pages, like Employee Access
    rowFill: '#F4F5F7', // checklist / highlighted rows
    line: '#E3EAF1',
    cardEdge: '#CFE3F0', // light-blue card border (family tile style)
    ink: '#3C4654', // large page titles / row labels (softer than pure black)
    faint: '#707781',
    danger: '#D13242',
    warning: '#F0A400',
  },
  dark: {
    text: '#EAEEF4',
    textSecondary: '#9AA4B2',
    background: '#0E1116',

    // In dark mode the two brand roles pull apart: an accent has to be light
    // enough to read *on* a dark surface, while a filled button has to be dark
    // enough for white text *on it*. Hence the separate `brandSurface`.
    brand: '#4FA3EC', // accent + text on dark surfaces (6.34:1 on surface)
    brandSurface: '#15558F', // filled backgrounds behind `onBrand` (7.70:1)
    brandDeep: '#1568BC',
    brandLight: '#3E7FB8',
    brandTint: '#132A40',
    onBrand: '#FFFFFF',
    onBrandMuted: '#C3D9EE',
    sketch: '#7FA9CE',
    sketchTint: '#15293C',
    money: '#2BD0A0',
    moneyBright: '#05C596',
    moneyTint: '#0F241E',
    torch: '#E23B34',
    torchFlame: '#F6A623',
    surface: '#171C24',
    ground: '#12161C',
    rowFill: '#1B222C',
    line: '#262D38',
    cardEdge: '#2A3644',
    ink: '#D6DEE8',
    faint: '#7B8492',
    danger: '#F0555F',
    warning: '#F0B429',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** 4pt spacing scale. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Corner radii. */
export const Radius = {
  sm: 9,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/** Type scale (fontSize / lineHeight / fontWeight). Large, regular-weight titles
 *  and roomy rows echo the Olympic Employee Access app. */
export const Type = {
  pageTitle: { fontSize: 30, lineHeight: 36, fontWeight: '500' },
  display: { fontSize: 40, lineHeight: 44, fontWeight: '800' },
  money: { fontSize: 30, lineHeight: 34, fontWeight: '800' },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  row: { fontSize: 18, lineHeight: 24, fontWeight: '500' },
  body: { fontSize: 15.5, lineHeight: 22, fontWeight: '400' },
  callout: { fontSize: 14.5, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: '400' },
  overline: { fontSize: 11.5, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8 },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
