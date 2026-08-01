import Svg, { Circle, Path } from 'react-native-svg';

type IconProps = { color: string; size?: number; strokeWidth?: number };

const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' });

export const ChevronRight = ({ color, size = 20, strokeWidth = 2.2 }: IconProps) => (
  <Svg {...base(size)}>
    <Path d="M9 6l6 6-6 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const ChevronLeft = ({ color, size = 22, strokeWidth = 2.2 }: IconProps) => (
  <Svg {...base(size)}>
    <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const Logout = ({ color, size = 18, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size)}>
    <Path
      d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const Rows = ({ color, size = 19, strokeWidth = 1.9 }: IconProps) => (
  <Svg {...base(size)}>
    <Path d="M3 7h18M3 12h18M3 17h18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const UserCircle = ({ color, size = 19, strokeWidth = 1.9 }: IconProps) => (
  <Svg {...base(size)}>
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const Home = ({ color, size = 22, strokeWidth = 1.9 }: IconProps) => (
  <Svg {...base(size)}>
    <Path
      d="M3 11l9-8 9 8M5 10v10h14V10"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const Clock = ({ color, size = 22, strokeWidth = 1.9 }: IconProps) => (
  <Svg {...base(size)}>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M12 8v4l3 2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const Mail = ({ color, size = 16, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size)}>
    <Path
      d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
    <Path d="M3.5 7l8.5 6 8.5-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
