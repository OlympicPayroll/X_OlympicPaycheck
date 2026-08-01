import { displayName, initials, usd } from '@/lib/format';

describe('usd', () => {
  it('renders cents and a thousands separator', () => {
    expect(usd(1755.02)).toBe('$1,755.02');
  });

  it('pads a whole-dollar amount to two decimals', () => {
    expect(usd(1620)).toBe('$1,620.00');
  });

  it('renders zero rather than an empty string', () => {
    expect(usd(0)).toBe('$0.00');
  });

  // Deductions are rendered with an explicit "−" prefix by the stub screen, but
  // a genuinely negative figure (a payroll correction) must still read clearly.
  it('marks a negative amount', () => {
    expect(usd(-12.5)).toBe('-$12.50');
  });

  it('handles six-figure YTD totals', () => {
    expect(usd(104233.7)).toBe('$104,233.70');
  });
});

describe('displayName', () => {
  it('flips payroll’s "LAST, FIRST" into natural order', () => {
    expect(displayName('MITCHELL, SARAH')).toBe('Sarah Mitchell');
  });

  it('keeps a two-part given name intact', () => {
    expect(displayName('VAN DYKE, MARY ANN')).toBe('Mary Ann Van Dyke');
  });

  it('capitalises after an apostrophe', () => {
    expect(displayName('O’BRIEN, PAT')).toBe('Pat O’Brien');
  });

  it('falls back to title-casing when payroll omits the comma', () => {
    expect(displayName('MITCHELL')).toBe('Mitchell');
  });

  it('tolerates missing spacing around the comma', () => {
    expect(displayName('MITCHELL,SARAH')).toBe('Sarah Mitchell');
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Sarah Mitchell')).toBe('SM');
  });

  it('handles a single name', () => {
    expect(initials('Sarah')).toBe('S');
  });

  it('stops at two letters', () => {
    expect(initials('Mary Ann Van Dyke')).toBe('MA');
  });

  // The header renders before the session lands, so this must not throw.
  it('returns nothing for an empty name', () => {
    expect(initials('')).toBe('');
  });
});
