import { router } from 'expo-router';

import type { Paycheck } from '@/api/types';

/**
 * Typed navigation for the payroll screens.
 *
 * Two things live here because getting them wrong is invisible until it isn't:
 *
 *   1. **Where a paycheck opens.** A period holding several separate checks
 *      opens a list; a combined period opens a merged stub; anything else opens
 *      one stub. The Dashboard and History both need that rule, and when only
 *      History had it the Dashboard silently opened a single check for periods
 *      that contain two.
 *
 *   2. **Which identifiers travel with it.** `id` addresses a pay period or an
 *      individual check; `sentId` addresses a *delivery* and is what the
 *      mark-read and email-a-copy actions operate on. They are different
 *      namespaces in the payroll API, so a missing `sentId` must stay missing
 *      rather than being backfilled with an `id` that happens to be a string.
 */

/** Route params that tell the login screen an arrival was deliberate. */
export const MANUAL_LOGIN_PARAMS = { pathname: '/' as const, params: { manual: '1' } };

/** Params the stub screen understands. */
export type StubParams = {
  /** Period or individual-check id. Absent for a combined view, which is addressed by date. */
  id?: string;
  /** ISO pay date — required for the combined view, useful context otherwise. */
  date?: string;
  /** '1' when several checks are shown merged. */
  combined?: string;
  /** Delivery id, when this payroll was delivered. Never synthesised. */
  sentId?: string;
  /** How the money arrived, e.g. "Direct deposit" — drives the net-pay label. */
  method?: string;
};

/**
 * Expo Router drops `undefined` params, but an explicit `undefined` in the
 * object is still the honest way to express "this payroll has no delivery id".
 * Stripping them keeps the URL clean and keeps `params.sentId` genuinely
 * absent rather than the string "undefined".
 */
function clean<T extends Record<string, string | undefined>>(params: T): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

/** Open one pay period from a list, branching on how many checks it holds. */
export function openPaycheck(paycheck: Paycheck) {
  const { id, payDateIso, payDate, checkCount, isCombined, sentId, method } = paycheck;

  // Several separate checks: show them individually, carrying the period's
  // delivery id so the list can hand it to whichever check the employee opens.
  if (checkCount > 1 && !isCombined) {
    router.push({
      pathname: '/checks',
      params: clean({ date: payDateIso, label: payDate, sentId }),
    });
    return;
  }

  router.push({
    pathname: '/stub',
    params: clean({
      id,
      date: payDateIso,
      combined: isCombined ? '1' : undefined,
      sentId,
      method,
    }),
  });
}

/**
 * Open one individual check from a period's check list.
 *
 * `sentId` comes from the *period*, not the check: the payroll was delivered
 * once, so opening any of its checks marks that one delivery read.
 */
export function openCheck(check: Paycheck, periodSentId?: string) {
  router.push({
    pathname: '/stub',
    params: clean({
      id: check.id,
      date: check.payDateIso,
      sentId: check.sentId ?? periodSentId,
      method: check.method,
    }),
  });
}
