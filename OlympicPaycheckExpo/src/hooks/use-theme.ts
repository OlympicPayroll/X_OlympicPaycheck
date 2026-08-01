/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  // react-native's useColorScheme can return light | dark | null | undefined.
  // Anything that isn't explicitly dark falls back to the light palette.
  return Colors[scheme === 'dark' ? 'dark' : 'light'];
}
