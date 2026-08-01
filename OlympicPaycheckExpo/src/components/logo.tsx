import { Image } from 'expo-image';

/**
 * The Olympic Payroll torch mark, recovered from the legacy app's launch image
 * and mirrored so the flames point left — matching the company website and the
 * Employee Access app icon. Transparent PNG, 191x360.
 *
 * `size` is the rendered height; width follows the mark's native aspect ratio.
 */
const source = require('../../assets/images/logo-torch.png');
const ASPECT = 191 / 360;

export function Logo({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={source}
      style={{ height: size, width: Math.round(size * ASPECT) }}
      contentFit="contain"
      accessibilityLabel="Olympic Paycheck"
    />
  );
}
