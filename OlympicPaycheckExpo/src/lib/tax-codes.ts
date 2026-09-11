/**
 * Plain-English meanings for the codes printed on a W-2.
 *
 * Box 12 codes are the IRS's own. Box 14 labels are chosen by the employer, so
 * only the ones New Jersey employers print are known here; anything else is
 * shown exactly as printed.
 */

const BOX_12: Record<string, string> = {
  A: 'Uncollected social security tax on tips',
  B: 'Uncollected Medicare tax on tips',
  C: 'Taxable cost of group-term life insurance over $50,000',
  D: 'Elective deferrals to a 401(k) plan',
  E: 'Elective deferrals to a 403(b) plan',
  F: 'Elective deferrals to a 408(k)(6) SEP',
  G: 'Deferrals to a 457(b) plan',
  H: 'Deferrals to a 501(c)(18)(D) plan',
  J: 'Nontaxable sick pay',
  K: 'Excise tax on excess golden parachute payments',
  L: 'Substantiated employee business expense reimbursements',
  M: 'Uncollected social security tax on group-term life insurance',
  N: 'Uncollected Medicare tax on group-term life insurance',
  P: 'Excludable moving expense reimbursements',
  Q: 'Nontaxable combat pay',
  R: 'Employer contributions to an Archer MSA',
  S: 'Salary reduction contributions to a SIMPLE plan',
  T: 'Adoption benefits',
  V: 'Income from exercising nonstatutory stock options',
  W: 'Employer contributions to a health savings account',
  Y: 'Deferrals under a section 409A nonqualified plan',
  Z: 'Income under a section 409A nonqualified plan',
  AA: 'Designated Roth contributions to a 401(k) plan',
  BB: 'Designated Roth contributions to a 403(b) plan',
  DD: 'Cost of employer-sponsored health coverage',
  EE: 'Designated Roth contributions to a 457(b) plan',
  FF: 'Permitted benefits under a QSEHRA',
  GG: 'Income from qualified equity grants under section 83(i)',
  HH: 'Aggregate deferrals under section 83(i) elections',
  II: 'Medicaid waiver payments excluded from income',
  TA: 'Employer contributions to a Trump account',
  TP: 'Total cash tips reported to your employer',
  TT: 'Qualified overtime compensation',
};

const BOX_14: Record<string, string> = {
  'UI/WF/SWF': 'NJ unemployment and workforce funds',
  DI: 'NJ temporary disability insurance',
  FLI: 'NJ family leave insurance',
};

/** What a box 12 code means, or undefined for a code we don't know. */
export function box12Meaning(code: string): string | undefined {
  return BOX_12[code.trim().toUpperCase()];
}

/** What a box 14 label means, or undefined when it is the employer's own. */
export function box14Meaning(label: string): string | undefined {
  return BOX_14[label.trim().toUpperCase()];
}
