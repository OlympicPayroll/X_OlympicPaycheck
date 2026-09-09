import { router } from 'expo-router';

import type { Paycheck } from '@/api/types';
import { openCheck, openPaycheck } from '@/lib/routes';

/**
 * Where a paycheck opens, and what travels with it.
 *
 * Both entry points — the Dashboard's latest-paycheck card and the History
 * list — route through the same helper, because when only History knew the
 * branching rule the Dashboard silently opened one check for periods holding
 * two. The identifier assertions matter for the same reason: `id` and `sentId`
 * are different namespaces, and substituting one for the other is invisible
 * until the real backend rejects it or, worse, acts on the wrong record.
 */

const push = router.push as jest.Mock;

/** The params of the single navigation this test performed. */
function navigation() {
  expect(push).toHaveBeenCalledTimes(1);
  return push.mock.calls[0][0] as { pathname: string; params: Record<string, string> };
}

function paycheck(overrides: Partial<Paycheck> = {}): Paycheck {
  return {
    id: 'H-20260718-regular-E-88214',
    payDate: 'Jul 18, 2026',
    payDateIso: '2026-07-18',
    net: 1755.02,
    method: 'Direct deposit',
    isNew: false,
    checkCount: 1,
    isCombined: false,
    ...overrides,
  };
}

describe('opening a pay period', () => {
  it('opens a single check straight onto its stub', () => {
    openPaycheck(paycheck());

    expect(navigation()).toMatchObject({
      pathname: '/stub',
      params: { id: 'H-20260718-regular-E-88214', date: '2026-07-18' },
    });
  });

  it('opens a period of several separate checks as a list', () => {
    openPaycheck(paycheck({ checkCount: 2, isCombined: false }));

    expect(navigation()).toMatchObject({
      pathname: '/checks',
      params: { date: '2026-07-18', label: 'Jul 18, 2026' },
    });
  });

  it('opens a combined period straight onto the merged stub', () => {
    openPaycheck(paycheck({ checkCount: 2, isCombined: true }));

    expect(navigation()).toMatchObject({
      pathname: '/stub',
      params: { date: '2026-07-18', combined: '1' },
    });
  });

  it('does not mark a multi-check period as combined', () => {
    openPaycheck(paycheck({ checkCount: 3, isCombined: false }));

    expect(navigation().params.combined).toBeUndefined();
  });
});

describe('identifiers carried through navigation', () => {
  it('carries the delivery id onto a single stub', () => {
    openPaycheck(paycheck({ sentId: 'S-20260718-E-88214' }));

    expect(navigation().params.sentId).toBe('S-20260718-E-88214');
  });

  /**
   * The check list is a waypoint, not a destination: if it drops the delivery
   * id, opening a check from it can no longer mark the payroll read and the
   * NEW badge sticks forever on exactly the periods with the most checks.
   */
  it('carries the delivery id into the check list', () => {
    openPaycheck(paycheck({ checkCount: 2, sentId: 'S-20260718-E-88214' }));

    expect(navigation()).toMatchObject({
      pathname: '/checks',
      params: { sentId: 'S-20260718-E-88214' },
    });
  });

  it('carries it on again from the list to an individual check', () => {
    openCheck(paycheck({ id: 'H-20260718-bonus-E-88214' }), 'S-20260718-E-88214');

    expect(navigation()).toMatchObject({
      pathname: '/stub',
      params: { id: 'H-20260718-bonus-E-88214', sentId: 'S-20260718-E-88214' },
    });
  });

  /**
   * A history row with no delivery must arrive with no delivery id. Filling
   * the gap with `id` — which the stub screen used to do — sends the payroll
   * service a pay-period id where it expects a delivery id.
   */
  it('leaves the delivery id absent when the payroll had none', () => {
    openPaycheck(paycheck({ sentId: undefined }));

    expect(navigation().params).not.toHaveProperty('sentId');
  });

  it('does not invent one for an individual check either', () => {
    openCheck(paycheck(), undefined);

    expect(navigation().params).not.toHaveProperty('sentId');
  });

  it('never passes the string "undefined"', () => {
    openPaycheck(paycheck({ sentId: undefined }));

    expect(Object.values(navigation().params)).not.toContain('undefined');
  });

  it('prefers a check’s own delivery id over the period’s', () => {
    openCheck(paycheck({ sentId: 'S-19990101-E-88214' }), 'S-20260718-E-88214');

    expect(navigation().params.sentId).toBe('S-19990101-E-88214');
  });
});

describe('payment method carried onto the stub', () => {
  it('travels with a single check so the stub can label it honestly', () => {
    openPaycheck(paycheck({ method: 'Paper check' }));

    expect(navigation().params.method).toBe('Paper check');
  });

  it('travels with an individual check from the list', () => {
    openCheck(paycheck({ method: 'Paper check' }), undefined);

    expect(navigation().params.method).toBe('Paper check');
  });
});
