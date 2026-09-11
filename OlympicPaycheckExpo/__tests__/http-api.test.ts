import { createHttpApi } from '@/api/http';
import { mockApi } from '@/api/mock';
import { ApiError, type ApiErrorCode } from '@/api/types';

/**
 * The HTTP adapter, against a stand-in payroll service.
 *
 * The stand-in implements the proposed contract (BACKEND_API_REQUIREMENTS.md
 * §11) on top of the fixture backend, so every answer that crosses the wire
 * can be compared with what the fixtures return directly: whatever the service
 * sends must reach the screens unchanged. When the real API arrives, these
 * tests are the checklist for adapting `http.ts` to it.
 */

jest.setTimeout(30_000);

const ORIGIN = 'https://payroll.example.test/mobile/v1';
const TOKEN = 't0k3n';
const EMPLOYEE = 'E-88214';
const COMPANY = 'CA-1041';
const CREDENTIALS = { email: 'sarah@cascade.test', ssnLast4: '4821' };

type Seen = { method: string; path: string; headers: Record<string, string>; body?: Record<string, unknown> };
type Handler = (ids: string[], body: Record<string, unknown>, query: Record<string, string>) => Promise<unknown>;

/** Just enough of a fetch Response for the adapter to read. */
function reply(status: number, body?: unknown, raw?: string): Response {
  const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
  return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response;
}

/** The proposed contract, served from the fixtures. */
const ROUTES: [string, RegExp, Handler][] = [
  [
    'POST',
    /^\/auth\/sign-in$/,
    async (_, body) => ({ token: TOKEN, ...(await mockApi.signIn(body as typeof CREDENTIALS)) }),
  ],
  ['POST', /^\/auth\/sign-out$/, async () => null],
  ['GET', /^\/employees\/([^/]+)\/paychecks\/latest$/, ([employeeId]) => mockApi.getLatestPaycheck({ employeeId })],
  ['GET', /^\/employees\/([^/]+)\/pay-years$/, () => mockApi.getPayYears()],
  [
    'GET',
    /^\/employees\/([^/]+)\/paychecks$/,
    ([employeeId], _, query) => mockApi.getPaychecks({ employeeId, year: Number(query.year) }),
  ],
  ['GET', /^\/companies\/([^/]+)\/stubs\/([^/]+)$/, ([companyId, paycheckId]) => mockApi.getStub({ companyId, paycheckId })],
  [
    'GET',
    /^\/employees\/([^/]+)\/pay-dates\/([^/]+)\/checks$/,
    ([employeeId, payDateIso]) => mockApi.getChecksForDate({ employeeId, payDateIso }),
  ],
  [
    'GET',
    /^\/employees\/([^/]+)\/pay-dates\/([^/]+)\/combined-stub$/,
    ([employeeId, payDateIso]) => mockApi.getCombinedStub({ employeeId, payDateIso }),
  ],
  [
    'POST',
    /^\/deliveries\/([^/]+)\/read$/,
    async ([sentId]) => {
      await mockApi.markPaycheckRead({ sentId });
      return null;
    },
  ],
  [
    'POST',
    /^\/deliveries\/([^/]+)\/email$/,
    async ([sentId]) => {
      await mockApi.emailStub({ sentId });
      return null;
    },
  ],
  [
    'GET',
    /^\/employees\/([^/]+)\/photo$/,
    async ([employeeId]) => {
      const uri = await mockApi.getPhoto({ employeeId });
      return uri ? { base64: uri.replace(/^data:[^,]+,/, '') } : null;
    },
  ],
  [
    'PUT',
    /^\/employees\/([^/]+)\/photo$/,
    async ([employeeId], body) => {
      await mockApi.uploadPhoto({ employeeId, base64: String(body.base64) });
      return null;
    },
  ],
  ['GET', /^\/employees\/([^/]+)\/tax-documents$/, ([employeeId]) => mockApi.getTaxDocuments({ employeeId })],
  [
    'GET',
    /^\/employees\/([^/]+)\/tax-documents\/([^/]+)\/w2$/,
    ([employeeId, documentId]) => mockApi.getW2({ employeeId, documentId }),
  ],
];

/** A stand-in payroll service: signs in, checks the token, and answers from the fixtures. */
function service() {
  const seen: Seen[] = [];

  const fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const [path, search = ''] = url.slice(ORIGIN.length).split('?');
    const query: Record<string, string> = Object.fromEntries(
      search
        .split('&')
        .filter(Boolean)
        .map((pair) => pair.split('=').map(decodeURIComponent)),
    );
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const method = init.method ?? 'GET';
    seen.push({ method, path, headers, body });

    if (!url.startsWith(ORIGIN)) return reply(404);
    if (path !== '/auth/sign-in' && headers.Authorization !== `Bearer ${TOKEN}`) return reply(401);

    for (const [verb, pattern, handle] of ROUTES) {
      const match = pattern.exec(path);
      if (verb !== method || !match) continue;
      try {
        return reply(200, await handle(match.slice(1).map(decodeURIComponent), body ?? {}, query));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        return reply(error.code === 'NOT_FOUND' ? 404 : 400, { error: { code: error.code, count: error.count } });
      }
    }
    return reply(404);
  });

  // The trailing slash is deliberate: a base URL may be configured with one.
  const api = createHttpApi({ baseUrl: `${ORIGIN}/`, fetch: fetch as unknown as typeof globalThis.fetch });
  return { api, fetch, seen };
}

async function signedIn() {
  const s = service();
  await s.api.signIn(CREDENTIALS);
  return s;
}

/** An adapter whose every request gets the same reply. */
function answering(response: Response | (() => Promise<Response>)) {
  const fetch = jest.fn(async () => (typeof response === 'function' ? response() : response));
  return createHttpApi({ baseUrl: ORIGIN, fetch: fetch as unknown as typeof globalThis.fetch });
}

async function codeOf(pending: Promise<unknown>): Promise<ApiErrorCode | undefined> {
  try {
    await pending;
    return undefined;
  } catch (error) {
    return error instanceof ApiError ? error.code : undefined;
  }
}

describe('signing in', () => {
  it('sends the credentials in the body, and returns the session without the token', async () => {
    const { api, seen } = service();

    const session = await api.signIn(CREDENTIALS);

    expect(seen[0]).toMatchObject({ method: 'POST', path: '/auth/sign-in', body: CREDENTIALS });
    expect(session).toEqual(await mockApi.signIn(CREDENTIALS));
    expect(JSON.stringify(session)).not.toContain(TOKEN);
  });

  /** Addresses end up in server logs; a body does not. */
  it('never puts credentials in the address', async () => {
    const { api, seen } = service();

    await api.signIn(CREDENTIALS);

    expect(seen[0].path).not.toMatch(/4821|sarah/);
  });

  it('sends the token on every later request', async () => {
    const { api, seen } = await signedIn();

    await api.getPayYears({ employeeId: EMPLOYEE });

    expect(seen[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('ends the sign-in on the service, then stops sending the token', async () => {
    const { api, seen } = await signedIn();

    await api.signOut();

    expect(seen[1]).toMatchObject({ method: 'POST', path: '/auth/sign-out' });
    expect(await codeOf(api.getPayYears({ employeeId: EMPLOYEE }))).toBe('SESSION_EXPIRED');
    expect(seen[2].headers.Authorization).toBeUndefined();
  });
});

describe('reading payroll', () => {
  it('returns exactly what the service sent, for every read the app makes', async () => {
    const { api } = await signedIn();
    const [latestPeriod] = await mockApi.getPaychecks({ employeeId: EMPLOYEE, year: 2026 });
    const multi = (await mockApi.getPaychecks({ employeeId: EMPLOYEE, year: 2025 })).find((p) => p.checkCount > 1)!;
    const issued = (await mockApi.getTaxDocuments({ employeeId: EMPLOYEE })).find((d) => d.status === 'available')!;
    const byDate = { employeeId: EMPLOYEE, payDateIso: multi.payDateIso };

    expect(await api.getLatestPaycheck({ employeeId: EMPLOYEE })).toEqual(
      await mockApi.getLatestPaycheck({ employeeId: EMPLOYEE }),
    );
    expect(await api.getPayYears({ employeeId: EMPLOYEE })).toEqual(await mockApi.getPayYears());
    expect(await api.getPaychecks({ employeeId: EMPLOYEE, year: 2025 })).toEqual(
      await mockApi.getPaychecks({ employeeId: EMPLOYEE, year: 2025 }),
    );
    expect(await api.getStub({ companyId: COMPANY, paycheckId: latestPeriod.id })).toEqual(
      await mockApi.getStub({ companyId: COMPANY, paycheckId: latestPeriod.id }),
    );
    expect(await api.getChecksForDate(byDate)).toEqual(await mockApi.getChecksForDate(byDate));
    expect(await api.getCombinedStub(byDate)).toEqual(await mockApi.getCombinedStub(byDate));
    expect(await api.getTaxDocuments({ employeeId: EMPLOYEE })).toEqual(
      await mockApi.getTaxDocuments({ employeeId: EMPLOYEE }),
    );
    expect(await api.getW2({ employeeId: EMPLOYEE, documentId: issued.id })).toEqual(
      await mockApi.getW2({ employeeId: EMPLOYEE, documentId: issued.id }),
    );
  });

  it('sends delivery actions to the delivery, not the pay period', async () => {
    const { api, seen } = await signedIn();
    const { sentId } = await mockApi.getLatestPaycheck({ employeeId: EMPLOYEE });

    await api.markPaycheckRead({ sentId: sentId! });
    await api.emailStub({ sentId: sentId! });

    expect(seen.slice(-2).map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST /deliveries/${sentId}/read`,
      `POST /deliveries/${sentId}/email`,
    ]);
  });

  it('uploads a profile photo and reads it back', async () => {
    const { api } = await signedIn();

    expect(await api.getPhoto({ employeeId: EMPLOYEE })).toBeNull();
    await api.uploadPhoto({ employeeId: EMPLOYEE, base64: 'aGVsbG8=' });

    expect(await api.getPhoto({ employeeId: EMPLOYEE })).toBe('data:image/jpeg;base64,aGVsbG8=');
  });

  it('escapes identifiers placed in the path', async () => {
    const { api, seen } = await signedIn();

    await codeOf(api.getStub({ companyId: 'CA 1041', paycheckId: 'H/1?x' }));

    expect(seen[1].path).toBe('/companies/CA%201041/stubs/H%2F1%3Fx');
  });
});

describe('turning failures into something the employee can act on', () => {
  it('passes on the errors the service names', async () => {
    const { api } = service();

    expect(await codeOf(api.signIn({ ...CREDENTIALS, email: 'unknown@nowhere.test' }))).toBe('INVALID_EMAIL');
    await expect(api.signIn({ ...CREDENTIALS, email: 'shared@cascade.test' })).rejects.toMatchObject({
      code: 'MULTIPLE_EMPLOYEES',
      count: 3,
    });
  });

  it('treats a refused sign-in with no named error as a wrong SSN', async () => {
    expect(await codeOf(answering(reply(401)).signIn(CREDENTIALS))).toBe('INVALID_SSN');
  });

  it('reports an ended session once the service stops accepting the token', async () => {
    const { api, fetch } = await signedIn();
    fetch.mockResolvedValueOnce(reply(401));

    expect(await codeOf(api.getPayYears({ employeeId: EMPLOYEE }))).toBe('SESSION_EXPIRED');
  });

  it('reports a record that is not there as not found', async () => {
    const { api } = await signedIn();

    expect(await codeOf(api.getW2({ employeeId: EMPLOYEE, documentId: 'W2-2026-E-88214' }))).toBe('NOT_FOUND');
  });

  it('keeps a server fault generic, even when the reply is an HTML error page', async () => {
    const api = answering(reply(500, undefined, '<html>Internal Server Error</html>'));

    expect(await codeOf(api.getPayYears({ employeeId: EMPLOYEE }))).toBe('SERVER');
  });

  it('treats a successful reply that is not JSON as a server fault', async () => {
    expect(await codeOf(answering(reply(200, undefined, 'OK')).getPayYears({ employeeId: EMPLOYEE }))).toBe('SERVER');
  });

  it('reports an unreachable service as a connection problem', async () => {
    const api = answering(() => Promise.reject(new TypeError('Network request failed')));

    expect(await codeOf(api.getPayYears({ employeeId: EMPLOYEE }))).toBe('NETWORK');
  });

  it('gives up on a service that never answers', async () => {
    jest.useFakeTimers();
    try {
      const fetch = jest.fn(
        (_input: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const api = createHttpApi({ baseUrl: ORIGIN, fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 5_000 });

      const pending = codeOf(api.getPayYears({ employeeId: EMPLOYEE }));
      await jest.advanceTimersByTimeAsync(5_000);

      expect(await pending).toBe('NETWORK');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('reading what comes back', () => {
  /** Better a clear error on screen than an undefined that crashes it later. */
  it('rejects a reply missing something the screens need', async () => {
    const api = answering(reply(200, { id: 'H-1', payDateIso: '2026-07-18', method: 'Direct deposit' }));

    expect(await codeOf(api.getLatestPaycheck({ employeeId: EMPLOYEE }))).toBe('SERVER');
  });

  it('accepts ids sent as numbers, money sent as decimal strings, and timestamps for dates', async () => {
    const api = answering(
      reply(200, { id: 90233, payDateIso: '2026-07-18T00:00:00', net: '1643.20', method: 'Direct deposit' }),
    );

    expect(await api.getLatestPaycheck({ employeeId: EMPLOYEE })).toEqual({
      id: '90233',
      payDate: 'Jul 18, 2026',
      payDateIso: '2026-07-18',
      net: 1643.2,
      method: 'Direct deposit',
      isNew: false,
      checkCount: 1,
      isCombined: false,
      sentId: undefined,
    });
  });

  it('never lets a full Social Security number through', async () => {
    const issued = (await mockApi.getTaxDocuments({ employeeId: EMPLOYEE })).find((d) => d.status === 'available')!;
    const w2 = await mockApi.getW2({ employeeId: EMPLOYEE, documentId: issued.id });
    const api = answering(reply(200, { ...w2, employee: { ...w2.employee, ssnMasked: '123-45-6789' } }));

    const read = await api.getW2({ employeeId: EMPLOYEE, documentId: issued.id });

    expect(read.employee.ssnMasked).toBe('XXX-XX-6789');
  });

  it('leaves out tax forms the app cannot show yet', async () => {
    const docs = await mockApi.getTaxDocuments({ employeeId: EMPLOYEE });
    const api = answering(
      reply(200, [
        ...docs,
        { id: '1099-2025', form: '1099-NEC', taxYear: 2025, employerName: 'X', status: 'available', date: 'Jan 31, 2026' },
      ]),
    );

    expect(await api.getTaxDocuments({ employeeId: EMPLOYEE })).toEqual(docs);
  });

  it('makes the pay date on a stub readable, however the service sends it', async () => {
    const [period] = await mockApi.getPaychecks({ employeeId: EMPLOYEE, year: 2026 });
    const stub = await mockApi.getStub({ companyId: COMPANY, paycheckId: period.id });
    const read = (sent: object) =>
      answering(reply(200, { ...stub, payDate: undefined, ...sent })).getStub({ companyId: COMPANY, paycheckId: period.id });

    expect(await read({ payDateIso: '2026-07-18' })).toEqual({ ...stub, payDate: 'Jul 18, 2026' });
    expect((await read({ payDate: '2026-07-18T00:00:00' })).payDate).toBe('Jul 18, 2026');
    expect((await read({ payDate: 'Jul 18, 2026', payDateIso: '2026-07-18' })).payDate).toBe('Jul 18, 2026');
    expect(await codeOf(read({}))).toBe('SERVER');
  });

  it('accepts yes or no sent as 1 and 0, or as text', async () => {
    const period = { id: 'H-1', payDateIso: '2026-07-18', net: 100, method: 'Direct deposit' };
    const read = (sent: object) =>
      answering(reply(200, { ...period, ...sent })).getLatestPaycheck({ employeeId: EMPLOYEE });

    expect(await read({ isNew: 1, isCombined: '0' })).toMatchObject({ isNew: true, isCombined: false });
    expect(await read({ isNew: 'True', isCombined: 'false' })).toMatchObject({ isNew: true, isCombined: false });
    expect(await codeOf(read({ isNew: 'maybe' }))).toBe('SERVER');
    expect(await codeOf(read({ isNew: 2 }))).toBe('SERVER');
  });

  it('accepts an address sent as one string with a line per row', async () => {
    const issued = (await mockApi.getTaxDocuments({ employeeId: EMPLOYEE })).find((d) => d.status === 'available')!;
    const w2 = await mockApi.getW2({ employeeId: EMPLOYEE, documentId: issued.id });
    const address = '118 Linden Avenue, Apt 2B\r\nMontclair, NJ 07042\n';
    const api = answering(reply(200, { ...w2, employee: { ...w2.employee, address } }));

    const read = await api.getW2({ employeeId: EMPLOYEE, documentId: issued.id });

    expect(read.employee.address).toEqual(['118 Linden Avenue, Apt 2B', 'Montclair, NJ 07042']);
    expect(read.employer.address).toEqual(w2.employer.address);
  });
});
