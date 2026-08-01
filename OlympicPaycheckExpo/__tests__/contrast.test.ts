import { Colors, type ThemeColor } from '@/constants/theme';

/**
 * WCAG 2.1 contrast checks on the design tokens.
 *
 * This is a payroll app: an employee reading a net-pay figure or an error
 * message must be able to read it in bright sun, in dark mode, and with
 * imperfect eyesight. Every foreground/background pair the UI actually renders
 * is checked here, so a palette change (D2, the boss's brand sign-off) can't
 * quietly reintroduce unreadable text.
 *
 * Thresholds are WCAG AA:
 *   • 4.5:1 — normal body text
 *   • 3.0:1 — large text (≥24px, or ≥18.66px bold) and UI component boundaries
 */

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

type Pair = {
  /** What the employee is actually looking at. */
  what: string;
  fg: ThemeColor;
  bg: ThemeColor;
  min: number;
};

/** Every foreground/background combination the screens render. */
const PAIRS: Pair[] = [
  // Body copy on the page and on cards.
  { what: 'body text on the page', fg: 'text', bg: 'background', min: AA_NORMAL },
  { what: 'body text on a card', fg: 'text', bg: 'surface', min: AA_NORMAL },
  { what: 'secondary text on the page', fg: 'textSecondary', bg: 'background', min: AA_NORMAL },
  { what: 'secondary text on a card', fg: 'textSecondary', bg: 'surface', min: AA_NORMAL },
  { what: 'row labels on a card', fg: 'ink', bg: 'surface', min: AA_NORMAL },
  { what: 'row labels on the page', fg: 'ink', bg: 'ground', min: AA_NORMAL },
  { what: 'row labels on a filled row', fg: 'ink', bg: 'rowFill', min: AA_NORMAL },

  // `faint` carries real copy: the NET PAY overline, legal links, photo hint.
  { what: 'faint captions on a card', fg: 'faint', bg: 'surface', min: AA_NORMAL },
  { what: 'faint captions on the page', fg: 'faint', bg: 'ground', min: AA_NORMAL },

  // Money. Rendered large on the stub hero, but also at 15px in list rows.
  { what: 'pay amounts on a card', fg: 'money', bg: 'surface', min: AA_NORMAL },
  { what: 'pay amounts on the summary card', fg: 'money', bg: 'moneyTint', min: AA_NORMAL },

  // Errors and warnings must never be the hardest thing on screen to read.
  { what: 'error text on the page', fg: 'danger', bg: 'ground', min: AA_NORMAL },
  { what: 'error text on a filled row', fg: 'danger', bg: 'rowFill', min: AA_NORMAL },

  // Text ON a brand-filled surface (buttons, the identity header, year chips).
  { what: 'primary button label', fg: 'onBrand', bg: 'brandSurface', min: AA_NORMAL },
  { what: 'year chip label', fg: 'onBrand', bg: 'brandSurface', min: AA_NORMAL },
  { what: 'employer name in the header', fg: 'onBrandMuted', bg: 'brandSurface', min: AA_NORMAL },

  // Brand-coloured text ON a neutral surface.
  { what: 'subtle button label', fg: 'brand', bg: 'brandTint', min: AA_NORMAL },
  { what: 'link text on a card', fg: 'brand', bg: 'surface', min: AA_NORMAL },
  { what: 'selected tab label', fg: 'brand', bg: 'sketchTint', min: AA_NORMAL },

  // Icons only need to be discernible, not readable.
  { what: 'back chevron on its squircle', fg: 'onBrand', bg: 'brandLight', min: AA_LARGE },

  // Non-text UI that still has to be discernible.
  { what: 'card border against the page', fg: 'cardEdge', bg: 'ground', min: 1.2 },
  { what: 'divider against a card', fg: 'line', bg: 'surface', min: 1.2 },
];

describe.each(['light', 'dark'] as const)('%s theme', (scheme) => {
  const palette = Colors[scheme];

  it.each(PAIRS)('$what reaches $min:1', ({ fg, bg, min }) => {
    const ratio = contrast(palette[fg], palette[bg]);

    // Reported to 2dp so a failure says exactly how far short it falls.
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min);
  });
});

describe('both themes', () => {
  it('defines the same tokens, so no screen loses a colour in one scheme', () => {
    expect(Object.keys(Colors.light).sort()).toEqual(Object.keys(Colors.dark).sort());
  });

  it('keeps the page and card surfaces distinguishable', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const palette = Colors[scheme];
      // Either they differ in colour, or a visible border separates them.
      const separated =
        palette.surface !== palette.ground || contrast(palette.cardEdge, palette.surface) >= 1.2;
      expect(separated).toBe(true);
    }
  });
});

describe('sample-data banner', () => {
  // Deliberately not theme-tokened: `warning` is bright amber in both schemes,
  // so the label stays dark rather than following `text` into white.
  const LABEL = '#2B2000';

  it.each(['light', 'dark'] as const)('stays readable in the %s theme', (scheme) => {
    expect(contrast(LABEL, Colors[scheme].warning)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('contrast helper', () => {
  it('scores black on white at 21:1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('is order-independent', () => {
    expect(contrast('#1E88E5', '#FFFFFF')).toBeCloseTo(contrast('#FFFFFF', '#1E88E5'), 5);
  });

  it('scores a colour against itself at 1:1', () => {
    expect(contrast('#1E88E5', '#1E88E5')).toBeCloseTo(1, 5);
  });
});
