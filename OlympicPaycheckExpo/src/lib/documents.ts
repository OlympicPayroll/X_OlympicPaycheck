import type { LineItem, StubDetail, W2, W2State } from '@/api/types';
import { usd } from '@/lib/format';
import { box12Meaning, box14Meaning } from '@/lib/tax-codes';

/**
 * Printable HTML for the documents an employee can keep as a PDF: the pay stub
 * and the W-2.
 *
 * The OS print engine renders it (see `pdf.ts`), so each document is
 * self-contained: inline CSS, system fonts, and images only as data URIs.
 */

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for HTML. Every value that comes from payroll passes through this. */
function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** "63,284.10": how amounts print on tax forms, without a dollar sign. */
function formAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** An unused W-2 box is left empty rather than showing 0.00. */
function boxAmount(n: number | undefined): string {
  return n ? formAmount(n) : '';
}

/**
 * Marks documents made from fixture data. A PDF outlives the app's demo banner
 * (it can be emailed, printed and filed), so it has to carry the warning itself.
 */
const SAMPLE_CSS = `
  .sample-mark { position: fixed; top: 36%; left: 0; right: 0; text-align: center; font-size: 110px;
    font-weight: 800; letter-spacing: 8px; color: rgba(217, 83, 79, 0.14); transform: rotate(-28deg); }
  .sample-bar { background: #FFC940; color: #2B2000; font-size: 9px; font-weight: 700; letter-spacing: 1.2px;
    text-align: center; padding: 4px 0; margin-bottom: 12px; }`;

const SAMPLE_MARKUP = '<div class="sample-mark">SAMPLE</div><div class="sample-bar">SAMPLE DATA · NOT REAL PAYROLL</div>';

function page(title: string, css: string, body: string, sample: boolean): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: letter; margin: 28px 32px; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif; color: #212529; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  ${sample ? SAMPLE_CSS : ''}
  ${css}
</style></head>
<body>${sample ? SAMPLE_MARKUP : ''}${body}</body></html>`;
}

/* -------------------------------------------------------------------------- */
/* Pay stub                                                                   */
/* -------------------------------------------------------------------------- */

export type PayStubDocument = {
  stub: StubDetail;
  employeeName: string;
  employerName: string;
  /** Several checks merged into one stub. */
  combined: boolean;
  /** Data URI of the torch logo, when it could be loaded. */
  logo?: string;
  /** Stamp the document as sample data. */
  sample: boolean;
};

const STUB_CSS = `
  .head { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 2px solid #0269C2; }
  .logo { height: 52px; }
  .who { flex: 1; }
  .employer { font-size: 19px; font-weight: 700; }
  .doc { font-size: 10px; color: #565656; margin-top: 3px; text-transform: uppercase; letter-spacing: 1px; }
  .net { text-align: right; }
  .net-label { font-size: 9px; color: #565656; text-transform: uppercase; letter-spacing: 1px; }
  .net-value { font-size: 24px; font-weight: 800; color: #03805F; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .meta { margin-top: 12px; }
  .meta th { text-align: left; font-size: 8.5px; font-weight: 600; color: #565656; text-transform: uppercase;
    letter-spacing: 0.8px; padding-bottom: 2px; }
  .meta td { font-size: 12px; font-weight: 600; }
  h2 { font-size: 11px; margin: 18px 0 4px; color: #0269C2; text-transform: uppercase; letter-spacing: 1px; }
  .lines td, .summary td, .summary th { padding: 5px 0; border-bottom: 1px solid #E3E6EA; }
  .summary th { font-size: 8.5px; font-weight: 600; color: #565656; text-transform: uppercase; letter-spacing: 0.8px;
    text-align: left; }
  .summary th.num { text-align: right; }
  .detail { display: block; color: #6B7280; font-size: 9.5px; margin-top: 1px; }
  .total td { font-weight: 700; border-top: 1.5px solid #212529; border-bottom: none; }
  footer { margin-top: 22px; font-size: 9px; color: #6B7280; }`;

/** A pay stub as a printable earnings statement. */
export function payStubHtml({ stub, employeeName, employerName, combined, logo, sample }: PayStubDocument): string {
  const minus = (negative: boolean) => (negative ? '−' : '');

  const section = (title: string, items: LineItem[], totalLabel: string, total: number, negative: boolean) =>
    items.length === 0
      ? ''
      : `<h2>${title}</h2>
    <table class="lines">
      ${items
        .map(
          (item) =>
            `<tr><td>${esc(item.label)}${item.detail ? `<span class="detail">${esc(item.detail)}</span>` : ''}</td>` +
            `<td class="num">${minus(negative)}${esc(usd(item.amount))}</td></tr>`,
        )
        .join('')}
      <tr class="total"><td>${totalLabel}</td><td class="num">${minus(negative)}${esc(usd(total))}</td></tr>
    </table>`;

  const summaryRow = (label: string, current: number, ytd: number, negative = false) =>
    `<tr><td>${label}</td><td class="num">${minus(negative)}${esc(usd(current))}</td>` +
    `<td class="num">${minus(negative)}${esc(usd(ytd))}</td></tr>`;

  const body = `
  <header class="head">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <div class="who">
      <div class="employer">${esc(employerName)}</div>
      <div class="doc">Earnings statement${combined ? ' · combined checks' : ''}</div>
    </div>
    <div class="net">
      <div class="net-label">Net pay</div>
      <div class="net-value">${esc(usd(stub.net))}</div>
    </div>
  </header>

  <table class="meta">
    <tr><th>Employee</th><th>Pay date</th><th>Payment</th></tr>
    <tr><td>${esc(employeeName)}</td><td>${esc(stub.payDate)}</td><td>${esc(stub.method ?? 'Multiple methods')}</td></tr>
  </table>

  ${section('Earnings', stub.earnings, 'Gross pay', stub.gross, false)}
  ${section('Taxes', stub.taxes, 'Total taxes', stub.taxTotal, true)}
  ${section('Deductions', stub.deductions, 'Total deductions', stub.deductionTotal, true)}

  <h2>Summary</h2>
  <table class="summary">
    <tr><th></th><th class="num">This check</th><th class="num">Year to date</th></tr>
    ${summaryRow('Gross pay', stub.gross, stub.ytd.gross)}
    ${summaryRow('Taxes', stub.taxTotal, stub.ytd.taxes, true)}
    ${summaryRow('Deductions', stub.deductionTotal, stub.ytd.deductions, true)}
    <tr class="total"><td>Net pay</td><td class="num">${esc(usd(stub.net))}</td><td class="num">${esc(usd(stub.ytd.net))}</td></tr>
  </table>

  <footer>Keep this statement for your records. Processed by Olympic Payroll for ${esc(employerName)}</footer>`;

  return page(`Pay stub, ${stub.payDate}`, STUB_CSS, body, sample);
}

/* -------------------------------------------------------------------------- */
/* Form W-2                                                                   */
/* -------------------------------------------------------------------------- */

export type W2Document = {
  w2: W2;
  /** Stamp the document as sample data. */
  sample: boolean;
};

/**
 * The employee copies, captioned as they are on the official form. Copies B
 * and C share the first page; Copy 2 shares the second with the notes.
 */
const W2_COPIES = {
  B: {
    title: 'Copy B—To Be Filed With Employee’s FEDERAL Tax Return.',
    note: 'This information is being furnished to the Internal Revenue Service.',
  },
  C: { title: 'Copy C—For EMPLOYEE’S RECORDS.', note: 'See the Notice to Employee on the next page.' },
  '2': { title: 'Copy 2—To Be Filed With Employee’s State, City, or Local Income Tax Return.', note: '' },
};

const W2_CSS = `
  .copy { padding-bottom: 10px; }
  .copy + .copy { border-top: 1px dashed #9CA3AF; padding-top: 10px; }
  .grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .box { border: 1px solid #111; padding: 2px 4px; vertical-align: top; height: 23px; }
  .lbl { font-family: -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif; font-size: 6.5px; font-weight: 400;
    line-height: 1.2; color: #111; }
  .lbl b { font-size: 7.5px; font-weight: 700; margin-right: 3px; }
  .val { font-family: 'Courier New', Courier, monospace; font-size: 9.5px; font-weight: 700; margin-top: 1px;
    text-align: right; }
  .val.text { text-align: left; line-height: 1.3; }
  .omb { font-size: 8px; font-weight: 600; text-align: center; vertical-align: middle; }
  .shaded { background: #E5E7EB; }
  .coded { width: 100%; border-collapse: collapse; margin-top: 1px; }
  .coded td { font-family: 'Courier New', Courier, monospace; font-size: 9.5px; font-weight: 700; padding: 0; }
  .coded .code { width: 26px; border-right: 1px solid #111; }
  .coded .amt { text-align: right; }
  .ticks { width: 100%; border-collapse: collapse; margin-top: 1px; }
  .ticks td { text-align: center; vertical-align: top; font-size: 5.5px; line-height: 1.15; padding: 0 1px; }
  .tick { width: 9px; height: 9px; border: 1px solid #111; margin: 0 auto 1px; font-size: 7px; line-height: 8px;
    font-weight: 700; }
  .other { width: 100%; border-collapse: collapse; margin-top: 1px; }
  .other td { font-family: 'Courier New', Courier, monospace; font-size: 8px; font-weight: 700; line-height: 1.2;
    padding: 0; }
  .state { margin-top: -1px; }
  .form-foot { display: flex; align-items: flex-end; justify-content: space-between; margin-top: 3px; }
  .form-name { font-size: 8.5px; }
  .form-name b { font-size: 15px; margin: 0 5px; }
  .form-year { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
  .dept { font-size: 7px; text-align: right; }
  .caption { font-size: 7px; margin-top: 2px; }
  .next-page { page-break-before: always; break-before: page; }
  .notice h1 { font-size: 14px; margin: 18px 0 6px; }
  .notice p, .notice li { font-size: 9.5px; line-height: 1.45; }
  .notice ul { padding-left: 16px; margin: 6px 0; }`;

function box(num: string, label: string, value: string, { text = false, attrs = '' } = {}): string {
  return (
    `<td class="box" ${attrs}><div class="lbl"><b>${num}</b>${label}</div>` +
    `<div class="val${text ? ' text' : ''}">${value}</div></td>`
  );
}

function w2Copy(w2: W2, copy: keyof typeof W2_COPIES): string {
  const { employee, employer } = w2;
  const { title, note } = W2_COPIES[copy];

  const box12 = (i: number) => {
    const entry = w2.box12[i];
    return (
      `<td class="box"><div class="lbl"><b>12${'abcd'[i]}</b>See instructions for box 12</div>` +
      `<table class="coded"><tr><td class="code">${entry ? esc(entry.code) : ''}</td>` +
      `<td class="amt">${entry ? formAmount(entry.amount) : ''}</td></tr></table></td>`
    );
  };

  const tick = (on: boolean, label: string) => `<td><div class="tick">${on ? 'X' : ''}</div>${label}</td>`;

  const other = w2.box14
    .map((line) => `<tr><td>${esc(line.label)}</td><td class="num">${formAmount(line.amount)}</td></tr>`)
    .join('');

  // Two state lines, as on the printed form, whether or not both are used.
  const stateCol = (pick: (s: W2State) => string) =>
    [0, 1].map((i) => (w2.states[i] ? pick(w2.states[i]) : '') || '&nbsp;').join('<br>');
  const stateBox = (num: string, label: string, pick: (s: W2State) => string, width: string, text = false) =>
    box(num, label, stateCol(pick), { text, attrs: `style="width:${width}"` });

  return `
  <div class="copy">
    <table class="grid">
      <colgroup><col style="width:44%"><col style="width:28%"><col style="width:28%"></colgroup>
      <tr>
        ${box('a', 'Employee’s social security number', esc(employee.ssnMasked), { text: true })}
        <td class="box omb" colspan="2">OMB No. 1545-0008</td>
      </tr>
      <tr>
        ${box('b', 'Employer identification number (EIN)', esc(employer.ein), { text: true })}
        ${box('1', 'Wages, tips, other compensation', formAmount(w2.wages))}
        ${box('2', 'Federal income tax withheld', formAmount(w2.federalIncomeTax))}
      </tr>
      <tr>
        ${box('c', 'Employer’s name, address, and ZIP code', [employer.name, ...employer.address].map(esc).join('<br>'), {
          text: true,
          attrs: 'rowspan="3"',
        })}
        ${box('3', 'Social security wages', formAmount(w2.socialSecurityWages))}
        ${box('4', 'Social security tax withheld', formAmount(w2.socialSecurityTax))}
      </tr>
      <tr>
        ${box('5', 'Medicare wages and tips', formAmount(w2.medicareWages))}
        ${box('6', 'Medicare tax withheld', formAmount(w2.medicareTax))}
      </tr>
      <tr>
        ${box('7', 'Social security tips', boxAmount(w2.socialSecurityTips))}
        ${box('8', 'Allocated tips', boxAmount(w2.allocatedTips))}
      </tr>
      <tr>
        ${box('d', 'Control number', esc(w2.controlNumber ?? ''), { text: true })}
        <td class="box shaded"><div class="lbl"><b>9</b></div></td>
        ${box('10', 'Dependent care benefits', boxAmount(w2.dependentCareBenefits))}
      </tr>
      <tr>
        ${box(
          'e',
          'Employee’s first name and initial&nbsp;&nbsp;&nbsp;Last name',
          [`${esc(employee.firstName)} ${esc(employee.lastName)}`, ...employee.address.map(esc)].join('<br>') +
            '<div class="lbl" style="margin-top:6px"><b>f</b>Employee’s address and ZIP code</div>',
          { text: true, attrs: 'rowspan="4"' },
        )}
        ${box('11', 'Nonqualified plans', boxAmount(w2.nonqualifiedPlans))}
        ${box12(0)}
      </tr>
      <tr>
        <td class="box"><div class="lbl"><b>13</b></div>
          <table class="ticks"><tr>
            ${tick(w2.statutoryEmployee, 'Statutory employee')}
            ${tick(w2.retirementPlan, 'Retirement plan')}
            ${tick(w2.thirdPartySickPay, 'Third-party sick pay')}
          </tr></table>
        </td>
        ${box12(1)}
      </tr>
      <tr>
        <td class="box" rowspan="2"><div class="lbl"><b>14</b>Other</div><table class="other">${other}</table></td>
        ${box12(2)}
      </tr>
      <tr>${box12(3)}</tr>
    </table>

    <table class="grid state"><tr>
      ${stateBox('15', 'State', (s) => esc(s.state), '7%', true)}
      ${stateBox('', 'Employer’s state ID number', (s) => esc(s.employerStateId), '21%', true)}
      ${stateBox('16', 'State wages, tips, etc.', (s) => formAmount(s.wages), '15%')}
      ${stateBox('17', 'State income tax', (s) => formAmount(s.incomeTax), '14%')}
      ${stateBox('18', 'Local wages, tips, etc.', (s) => boxAmount(s.localWages), '15%')}
      ${stateBox('19', 'Local income tax', (s) => boxAmount(s.localIncomeTax), '14%')}
      ${stateBox('20', 'Locality name', (s) => esc(s.locality ?? ''), '14%', true)}
    </tr></table>

    <div class="form-foot">
      <div class="form-name">Form<b>W-2</b>Wage and Tax Statement</div>
      <div class="form-year">${w2.taxYear}</div>
      <div class="dept">Department of the Treasury—Internal Revenue Service</div>
    </div>
    <div class="caption"><b>${title}</b> ${note}</div>
  </div>`;
}

/** Plain-language notes for the codes and boxes this particular W-2 uses. */
function w2Notice(w2: W2): string {
  const codes = w2.box12
    .map((entry) => `<li><b>Box 12, code ${esc(entry.code)}</b>: ${esc(box12Meaning(entry.code) ?? 'see IRS instructions')}.</li>`)
    .join('');
  const other = w2.box14
    .map((line) => {
      const meaning = box14Meaning(line.label);
      return meaning ? `<li><b>Box 14, ${esc(line.label)}</b>: ${esc(meaning)}.</li>` : '';
    })
    .join('');

  return `
  <div class="notice">
    <h1>Notice to Employee</h1>
    <p>File Copy B with your federal tax return and Copy 2 with any state or local return that asks for it. Keep Copy C for your records.</p>
    <ul>
      <li><b>Box 1</b> is your pay subject to federal income tax. Contributions you made to a retirement plan through payroll are not included, so it can be lower than your total pay.</li>
      <li><b>Boxes 3 and 5</b> are your pay subject to Social Security and Medicare tax. Retirement plan contributions are included here.</li>
      ${codes}
      ${w2.retirementPlan ? '<li><b>Box 13, Retirement plan</b> is checked because you took part in your employer’s retirement plan during the year.</li>' : ''}
      ${other}
      <li><b>Boxes 15 to 17</b> are your state wages and the state income tax withheld.</li>
    </ul>
    <p>For your security, only the last four digits of your Social Security number are shown, as the IRS allows on employee copies. Your employer reports the full number to the Social Security Administration.</p>
    <p>If your name, Social Security number or any amount is wrong, contact your employer. Corrections are issued on Form W-2c.</p>
  </div>`;
}

/** A W-2 as the employee copies of the form: B and C on page one, 2 and the notes on page two. */
export function w2Html({ w2, sample }: W2Document): string {
  const body = `
  ${w2Copy(w2, 'B')}
  ${w2Copy(w2, 'C')}
  <div class="next-page">
    ${w2Copy(w2, '2')}
    ${w2Notice(w2)}
  </div>`;
  return page(`Form W-2 ${w2.taxYear}`, W2_CSS, body, sample);
}
