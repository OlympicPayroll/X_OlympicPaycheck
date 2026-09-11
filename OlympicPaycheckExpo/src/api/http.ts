import type { PayrollApi } from '@/api/client';
import {
  ApiError,
  type ApiErrorCode,
  type CodedAmount,
  type Company,
  type LabelledAmount,
  type LineItem,
  type Paycheck,
  type Session,
  type StubDetail,
  type TaxDocument,
  type W2,
  type W2State,
} from '@/api/types';

/**
 * The payroll service over HTTPS: the backend the app uses once
 * `EXPO_PUBLIC_API_URL` is set.
 *
 * It speaks the contract proposed in BACKEND_API_REQUIREMENTS.md §11. Where
 * Olympic Payroll's real API differs, the differences belong here, in `ROUTES`
 * and the readers at the bottom of this file, and nowhere else. Screens only
 * ever see the domain types in `types.ts`, and the contract tests run against
 * whatever this returns.
 *
 * Every response is checked on the way in. A payload missing something a
 * screen needs becomes a SERVER error the screen can show, instead of an
 * `undefined` that crashes it three components later.
 */

export type HttpApiOptions = {
  /** e.g. "https://api.example.com/mobile/v1". */
  baseUrl: string;
  /** The global fetch, unless a test supplies its own. */
  fetch?: typeof fetch;
  /** A request that hasn't answered in this long is abandoned as a network failure. */
  timeoutMs?: number;
};

type Method = 'GET' | 'POST' | 'PUT';

const DEFAULT_TIMEOUT_MS = 20_000;

const seg = encodeURIComponent;

/** Every path the app calls, in one place, so matching the real API is one edit. */
const ROUTES = {
  signIn: () => '/auth/sign-in',
  signOut: () => '/auth/sign-out',
  latestPaycheck: (employeeId: string) => `/employees/${seg(employeeId)}/paychecks/latest`,
  payYears: (employeeId: string) => `/employees/${seg(employeeId)}/pay-years`,
  paychecks: (employeeId: string, year: number) => `/employees/${seg(employeeId)}/paychecks?year=${year}`,
  stub: (companyId: string, paycheckId: string) => `/companies/${seg(companyId)}/stubs/${seg(paycheckId)}`,
  checksForDate: (employeeId: string, payDateIso: string) =>
    `/employees/${seg(employeeId)}/pay-dates/${seg(payDateIso)}/checks`,
  combinedStub: (employeeId: string, payDateIso: string) =>
    `/employees/${seg(employeeId)}/pay-dates/${seg(payDateIso)}/combined-stub`,
  markRead: (sentId: string) => `/deliveries/${seg(sentId)}/read`,
  emailStub: (sentId: string) => `/deliveries/${seg(sentId)}/email`,
  photo: (employeeId: string) => `/employees/${seg(employeeId)}/photo`,
  taxDocuments: (employeeId: string) => `/employees/${seg(employeeId)}/tax-documents`,
  w2: (employeeId: string, documentId: string) =>
    `/employees/${seg(employeeId)}/tax-documents/${seg(documentId)}/w2`,
};

/** Error codes the service may name in `{ "error": { "code": "…" } }`. */
const NAMED_ERRORS: Record<string, ApiErrorCode> = {
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_SSN: 'INVALID_SSN',
  MULTIPLE_EMPLOYEES: 'MULTIPLE_EMPLOYEES',
  NOT_FOUND: 'NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
};

/** Marks a body that could not be parsed, as distinct from an empty one. */
const NOT_JSON = Symbol('not-json');

export function createHttpApi({ baseUrl, fetch: injected, timeoutMs = DEFAULT_TIMEOUT_MS }: HttpApiOptions): PayrollApi {
  const root = baseUrl.trim().replace(/\/+$/, '');
  const send: typeof fetch = injected ?? ((input, init) => globalThis.fetch(input, init));

  /** The bearer token from sign-in. Memory only, like the session it belongs to. */
  let token: string | null = null;

  async function call(method: Method, path: string, body?: unknown, { signingIn = false } = {}): Promise<unknown> {
    const what = `${method} ${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await send(`${root}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // Offline, DNS, TLS, or the timeout above: to the employee they are all
      // "check your connection".
      throw new ApiError('NETWORK', `${what} did not complete`);
    } finally {
      clearTimeout(timer);
    }

    const payload = await readBody(response);
    if (!response.ok) throw failure(response.status, payload, what, signingIn);
    if (payload === NOT_JSON) throw new ApiError('SERVER', `${what}: response was not JSON`);
    return payload;
  }

  return {
    async signIn(credentials) {
      const body = record(await call('POST', ROUTES.signIn(), credentials, { signingIn: true }), 'sign-in');
      const session = toSession(body);
      token = text(body.token, 'sign-in token');
      return session;
    },

    async signOut() {
      if (!token) return;
      try {
        await call('POST', ROUTES.signOut());
      } catch {
        // Signing out on this phone matters more than telling the server.
      } finally {
        token = null;
      }
    },

    async getLatestPaycheck({ employeeId }) {
      return toPaycheck(await call('GET', ROUTES.latestPaycheck(employeeId)), 'latest paycheck');
    },

    async getPayYears({ employeeId }) {
      return list(await call('GET', ROUTES.payYears(employeeId)), 'pay years', num);
    },

    async getPaychecks({ employeeId, year }) {
      return list(await call('GET', ROUTES.paychecks(employeeId, year)), 'paychecks', toPaycheck);
    },

    async getStub({ companyId, paycheckId }) {
      return toStub(await call('GET', ROUTES.stub(companyId, paycheckId)), 'stub');
    },

    async getChecksForDate({ employeeId, payDateIso }) {
      return list(await call('GET', ROUTES.checksForDate(employeeId, payDateIso)), 'checks', toPaycheck);
    },

    async getCombinedStub({ employeeId, payDateIso }) {
      return toStub(await call('GET', ROUTES.combinedStub(employeeId, payDateIso)), 'combined stub');
    },

    async markPaycheckRead({ sentId }) {
      await call('POST', ROUTES.markRead(sentId));
    },

    async emailStub({ sentId }) {
      await call('POST', ROUTES.emailStub(sentId));
    },

    async getPhoto({ employeeId }) {
      return toPhoto(await call('GET', ROUTES.photo(employeeId)));
    },

    async uploadPhoto({ employeeId, base64 }) {
      await call('PUT', ROUTES.photo(employeeId), { base64 });
    },

    async getTaxDocuments({ employeeId }) {
      return toTaxDocuments(await call('GET', ROUTES.taxDocuments(employeeId)));
    },

    async getW2({ employeeId, documentId }) {
      return toW2(await call('GET', ROUTES.w2(employeeId, documentId)));
    },
  };
}

async function readBody(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => '');
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return NOT_JSON;
  }
}

/** Turn a failed response into the error the screens know how to explain. */
function failure(status: number, payload: unknown, what: string, signingIn: boolean): ApiError {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  const named = typeof error?.code === 'string' ? NAMED_ERRORS[error.code.toUpperCase()] : undefined;
  if (named) {
    return new ApiError(named, `${what}: ${named}`, typeof error?.count === 'number' ? error.count : undefined);
  }

  // No named code, so go by the status. A 401 while signing in means the
  // credentials were refused; any later 401 means the session has ended.
  if (status === 401) return new ApiError(signingIn ? 'INVALID_SSN' : 'SESSION_EXPIRED', `${what}: HTTP 401`);
  if (status === 404) return new ApiError('NOT_FOUND', `${what}: HTTP 404`);
  return new ApiError('SERVER', `${what}: HTTP ${status}`);
}

/* -------------------------------------------------------------------------- */
/* Readers: from the wire to the domain types                                 */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(what: string): ApiError {
  return new ApiError('SERVER', `Unexpected response: ${what}`);
}

function record(value: unknown, what: string): Json {
  if (isRecord(value)) return value;
  throw malformed(what);
}

function list<T>(value: unknown, what: string, read: (item: unknown, what: string) => T): T[] {
  if (!Array.isArray(value)) throw malformed(what);
  return value.map((item, i) => read(item, `${what}[${i}]`));
}

/** Text, including ids a database may send as numbers. */
function text(value: unknown, what: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw malformed(what);
}

function optionalText(value: unknown, what: string): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : text(value, what);
}

/** Numbers, including money sent as a decimal string ("1643.20"), as .NET services often do. */
function num(value: unknown, what: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  throw malformed(what);
}

function optionalNum(value: unknown, what: string): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : num(value, what);
}

/** Yes or no, including the 1/0 and "true"/"false" that .NET and SQL services often send. */
function flag(value: unknown, what: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' || typeof value === 'string') {
    const said = String(value).trim().toLowerCase();
    if (said === '1' || said === 'true') return true;
    if (said === '0' || said === 'false') return false;
  }
  throw malformed(what);
}

/** Address lines: a list, or one string with a line break per row. */
function lines(value: unknown, what: string): string[] {
  if (typeof value !== 'string') return list(value, what, text);
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-07-18" (or a full ISO timestamp) to "Jul 18, 2026", for services that send only the ISO date. */
function displayDate(iso: string, what: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) throw malformed(what);
  const [, y, m, d] = match;
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

/**
 * The pay date as the employee reads it. A service may send it ready to show,
 * send only the ISO date, or put an ISO date in the display field; the
 * employee sees "Jul 18, 2026" in every case.
 */
function payDateFor(display: unknown, iso: string | undefined, what: string): string {
  const shown = optionalText(display, `${what}.payDate`) ?? iso;
  if (!shown) throw malformed(`${what}.payDate`);
  return /^\d{4}-\d{2}-\d{2}/.test(shown) ? displayDate(shown, `${what}.payDate`) : shown;
}

/**
 * Only ever the last four digits. The app must never hold a full Social
 * Security number, so if one arrives anyway it is truncated here, before any
 * screen or PDF can see it.
 */
function maskSsn(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `XXX-XX-${digits.slice(-4).padStart(4, 'X')}`;
}

function toSession(body: Json): Session {
  const employee = record(body.employee, 'employee');
  return {
    employee: {
      id: text(employee.id, 'employee.id'),
      fullName: text(employee.fullName, 'employee.fullName'),
      firstName: text(employee.firstName, 'employee.firstName'),
    },
    companies: list(body.companies, 'companies', toCompany),
  };
}

function toCompany(value: unknown, what: string): Company {
  const company = record(value, what);
  return {
    id: text(company.id, `${what}.id`),
    employeeId: text(company.employeeId, `${what}.employeeId`),
    name: text(company.name, `${what}.name`),
    latestPayrollId: optionalText(company.latestPayrollId, `${what}.latestPayrollId`) ?? '',
  };
}

function toPaycheck(value: unknown, what: string): Paycheck {
  const p = record(value, what);
  const payDateIso = text(p.payDateIso, `${what}.payDateIso`).slice(0, 10);
  return {
    id: text(p.id, `${what}.id`),
    payDate: payDateFor(p.payDate, payDateIso, what),
    payDateIso,
    net: num(p.net, `${what}.net`),
    method: text(p.method, `${what}.method`),
    isNew: flag(p.isNew, `${what}.isNew`, false),
    checkCount: optionalNum(p.checkCount, `${what}.checkCount`) ?? 1,
    isCombined: flag(p.isCombined, `${what}.isCombined`, false),
    sentId: optionalText(p.sentId, `${what}.sentId`),
  };
}

function toLineItem(value: unknown, what: string): LineItem {
  const item = record(value, what);
  return {
    label: text(item.label, `${what}.label`),
    detail: optionalText(item.detail, `${what}.detail`),
    amount: num(item.amount, `${what}.amount`),
  };
}

function toStub(value: unknown, what: string): StubDetail {
  const s = record(value, what);
  const ytd = record(s.ytd, `${what}.ytd`);
  return {
    id: text(s.id, `${what}.id`),
    payDate: payDateFor(s.payDate, optionalText(s.payDateIso, `${what}.payDateIso`), what),
    method: optionalText(s.method, `${what}.method`),
    net: num(s.net, `${what}.net`),
    gross: num(s.gross, `${what}.gross`),
    earnings: list(s.earnings, `${what}.earnings`, toLineItem),
    taxes: list(s.taxes, `${what}.taxes`, toLineItem),
    deductions: list(s.deductions, `${what}.deductions`, toLineItem),
    taxTotal: num(s.taxTotal, `${what}.taxTotal`),
    deductionTotal: num(s.deductionTotal, `${what}.deductionTotal`),
    ytd: {
      gross: num(ytd.gross, `${what}.ytd.gross`),
      net: num(ytd.net, `${what}.ytd.net`),
      taxes: num(ytd.taxes, `${what}.ytd.taxes`),
      deductions: num(ytd.deductions, `${what}.ytd.deductions`),
    },
  };
}

/** A photo arrives as a URL, as base64, or not at all. */
function toPhoto(value: unknown): string | null {
  if (value === null) return null;
  const photo = record(value, 'photo');
  const url = optionalText(photo.url, 'photo.url');
  if (url) return url;
  const base64 = optionalText(photo.base64, 'photo.base64');
  return base64 ? `data:image/jpeg;base64,${base64}` : null;
}

/** Forms the app doesn't show yet (a W-2c, a 1099) are left out rather than failing the whole list. */
function toTaxDocuments(value: unknown): TaxDocument[] {
  if (!Array.isArray(value)) throw malformed('tax documents');
  return value
    .filter((item) => isRecord(item) && typeof item.form === 'string' && item.form.replace('-', '').toUpperCase() === 'W2')
    .map((item, i) => {
      const doc = record(item, `tax documents[${i}]`);
      const status = text(doc.status, `tax documents[${i}].status`);
      if (status !== 'available' && status !== 'pending') throw malformed(`tax documents[${i}].status`);
      return {
        id: text(doc.id, `tax documents[${i}].id`),
        form: 'W-2' as const,
        taxYear: num(doc.taxYear, `tax documents[${i}].taxYear`),
        employerName: text(doc.employerName, `tax documents[${i}].employerName`),
        status,
        date: text(doc.date, `tax documents[${i}].date`),
      };
    });
}

function toCoded(value: unknown, what: string): CodedAmount {
  const entry = record(value, what);
  return { code: text(entry.code, `${what}.code`), amount: num(entry.amount, `${what}.amount`) };
}

function toLabelled(value: unknown, what: string): LabelledAmount {
  const entry = record(value, what);
  return { label: text(entry.label, `${what}.label`), amount: num(entry.amount, `${what}.amount`) };
}

function toState(value: unknown, what: string): W2State {
  const s = record(value, what);
  return {
    state: text(s.state, `${what}.state`),
    employerStateId: text(s.employerStateId, `${what}.employerStateId`),
    wages: num(s.wages, `${what}.wages`),
    incomeTax: num(s.incomeTax, `${what}.incomeTax`),
    localWages: optionalNum(s.localWages, `${what}.localWages`),
    localIncomeTax: optionalNum(s.localIncomeTax, `${what}.localIncomeTax`),
    locality: optionalText(s.locality, `${what}.locality`),
  };
}

function toW2(value: unknown): W2 {
  const w = record(value, 'W-2');
  const employee = record(w.employee, 'W-2 employee');
  const employer = record(w.employer, 'W-2 employer');
  const box = (key: string) => optionalNum(w[key], `W-2 ${key}`) ?? 0;

  return {
    id: text(w.id, 'W-2 id'),
    taxYear: num(w.taxYear, 'W-2 taxYear'),
    employee: {
      firstName: text(employee.firstName, 'W-2 employee.firstName'),
      lastName: text(employee.lastName, 'W-2 employee.lastName'),
      address: lines(employee.address, 'W-2 employee.address'),
      ssnMasked: maskSsn(text(employee.ssnMasked, 'W-2 employee.ssnMasked')),
    },
    employer: {
      name: text(employer.name, 'W-2 employer.name'),
      address: lines(employer.address, 'W-2 employer.address'),
      ein: text(employer.ein, 'W-2 employer.ein'),
    },
    controlNumber: optionalText(w.controlNumber, 'W-2 controlNumber'),
    wages: num(w.wages, 'W-2 wages'),
    federalIncomeTax: num(w.federalIncomeTax, 'W-2 federalIncomeTax'),
    socialSecurityWages: num(w.socialSecurityWages, 'W-2 socialSecurityWages'),
    socialSecurityTax: num(w.socialSecurityTax, 'W-2 socialSecurityTax'),
    medicareWages: num(w.medicareWages, 'W-2 medicareWages'),
    medicareTax: num(w.medicareTax, 'W-2 medicareTax'),
    socialSecurityTips: box('socialSecurityTips'),
    allocatedTips: box('allocatedTips'),
    dependentCareBenefits: box('dependentCareBenefits'),
    nonqualifiedPlans: box('nonqualifiedPlans'),
    box12: list(w.box12 ?? [], 'W-2 box12', toCoded),
    statutoryEmployee: flag(w.statutoryEmployee, 'W-2 statutoryEmployee', false),
    retirementPlan: flag(w.retirementPlan, 'W-2 retirementPlan', false),
    thirdPartySickPay: flag(w.thirdPartySickPay, 'W-2 thirdPartySickPay', false),
    box14: list(w.box14 ?? [], 'W-2 box14', toLabelled),
    states: list(w.states ?? [], 'W-2 states', toState),
  };
}
