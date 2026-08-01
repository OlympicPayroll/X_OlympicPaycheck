/** Format a number as USD, e.g. 1755.02 → "$1,755.02". */
export function usd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** "MITCHELL, SARAH" → "Sarah Mitchell". Payroll stores names last-first. */
export function displayName(payrollName: string): string {
  const [last, first] = payrollName.split(',').map((s) => s.trim());
  const cap = (s: string) => s.replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return first ? `${cap(first)} ${cap(last)}` : cap(payrollName);
}

/** Initials for the avatar, e.g. "Sarah Mitchell" → "SM". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
