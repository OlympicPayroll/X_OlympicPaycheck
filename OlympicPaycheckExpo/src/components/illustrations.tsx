import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/**
 * Friendly hand-drawn-style line illustrations echoing the Olympic "Employee
 * Access" app: a soft blue blob, a rounded blue outline icon, and a couple of
 * sparkle accents. Used for the feature cards on Home.
 */
export type IllustrationName = 'wallet' | 'receipt' | 'camera';

const SPARKLES = [
  { cx: 40, cy: 9, r: 1.6 },
  { cx: 7, cy: 15, r: 1.3 },
  { cx: 42, cy: 33, r: 1.1 },
];

export function Illustration({ name, size = 46 }: { name: IllustrationName; size?: number }) {
  const theme = useTheme();
  const line = theme.sketch;

  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* soft blob */}
      <Circle cx="24" cy="25" r="16" fill={theme.sketchTint} />

      {name === 'wallet' && (
        <>
          <Rect x="12" y="17" width="24" height="16" rx="3.5" stroke={line} strokeWidth={1.8} />
          <Path d="M12 21h20a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H12" stroke={line} strokeWidth={1.8} />
          <Circle cx="30.5" cy="25" r="1.6" fill={line} />
        </>
      )}

      {name === 'receipt' && (
        <>
          <Path
            d="M16 13h13l3 3v19l-2.2-1.6L27.6 35l-2.6-1.7L22.4 35l-2.6-1.7L17.2 35 16 34V13Z"
            stroke={line}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <Path d="M20 20h8M20 24h8M20 28h5" stroke={line} strokeWidth={1.8} strokeLinecap="round" />
        </>
      )}

      {name === 'camera' && (
        <>
          <Rect x="12" y="18" width="24" height="15" rx="3.5" stroke={line} strokeWidth={1.8} />
          <Path d="M18 18l1.6-3h8.8L30 18" stroke={line} strokeWidth={1.8} strokeLinejoin="round" />
          <Circle cx="24" cy="25.5" r="4.2" stroke={line} strokeWidth={1.8} />
        </>
      )}

      {SPARKLES.map((s, i) => (
        <Path
          key={i}
          d={`M${s.cx} ${s.cy - s.r * 2} L${s.cx + s.r} ${s.cy} L${s.cx} ${s.cy + s.r * 2} L${s.cx - s.r} ${s.cy} Z`}
          fill={line}
          opacity={0.55}
        />
      ))}
    </Svg>
  );
}
