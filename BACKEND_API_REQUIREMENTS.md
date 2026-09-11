# Olympic Paycheck (mobile) — Backend API Requirements

**For:** the Olympic Payroll backend team
**From:** the Olympic Paycheck mobile rebuild
**Status:** awaiting backend contract — this is the blocking dependency
**Last updated:** 2026-08-01

---

## 1. What this document is

The Olympic Paycheck iOS app is being rebuilt as a single React Native codebase
for iOS and Android. **The app is feature-complete and running on device today**,
but every figure in it is fixture data. It cannot show a real employee a real pay
stub until it can talk to a real backend.

The endpoint the legacy app used —
`https://myolympicpay.com/WebServices/EmplPayrollInfo.asmx` — is decommissioned.
Probed 2026-07-22: a `GET` returns the new Angular marketing site, and a `POST`
returns IIS `405 — HTTP verb not allowed`. A live ASMX service would return a
SOAP response or a SOAP fault, not a 405.

The data clearly still exists: the newer **Olympic Employee Access** app serves it
from a different backend. We need the contract for that backend.

**This document is not a demand that you build a new API.** It is a precise
statement of what the app consumes, so you can tell us which existing endpoints
already provide it, which need a field added, and which don't exist yet. If your
API's shape differs from what's below, that is fine — the app has a single
adapter layer designed for exactly this, and we will map to whatever you have.
What matters is that the *information* is reachable.

---

## 2. What we need from you

In rough priority order:

1. **Base URL(s)** for the API the Employee Access app uses — production, plus a
   sandbox/staging environment if one exists.
2. **API documentation** in any form: Swagger/OpenAPI, a Postman collection, a
   WSDL, or even a working example request. Anything beats a guess.
3. **The authentication scheme.** See §4 — this is the largest unknown and the
   one most likely to change our design.
4. **Two or three test accounts** against non-production data, covering:
   - a single-employer employee,
   - a multi-employer employee,
   - an employee with a pay period containing more than one check.
5. **Answers to the open questions in §7.**

Items 1–3 unblock development. Item 4 unblocks verification — we cannot confirm
the app renders real payroll correctly without real responses.

---

## 3. Operations the app needs

Thirteen operations. The first eleven each map one-to-one onto a method the
legacy SOAP service already exposed, which is our evidence that the payroll system holds this data —
the column is there to help you locate the equivalent in the new system.

| # | App operation | Legacy SOAP method | Purpose |
|---|---|---|---|
| 1 | `signIn` | `GetClientAccountsInformations` | Authenticate; return employee + their employers |
| 2 | `getLatestPaycheck` | `GetLatestPayroll` | Most recent pay period |
| 3 | `getPayYears` | `GetPayrollYears` | Years with payroll history |
| 4 | `getPaychecks` | `GetPayrollHistory` | Pay periods within a year |
| 5 | `getStub` | `GetEmployeePayrollDetails` | Full stub detail for one check |
| 6 | `getChecksForDate` | `GetMultipleCheckList` | Individual checks when a period has several |
| 7 | `getCombinedStub` | `GetEmpCombinedPayroll` | Several checks merged into one stub |
| 8 | `markPaycheckRead` | `FlagReadPayrolls` | Clear the "new" flag |
| 9 | `emailStub` | `SendEmail` | Email a stub to the address on record |
| 10 | `getPhoto` | `GetEmployeePhoto` | Profile photo |
| 11 | `uploadPhoto` | `InsertBase64Photo` | Replace profile photo |
| 12 | `getTaxDocuments` | *(none, new feature)* | The employee's W-2s by year, and whether this year's is issued yet |
| 13 | `getW2` | *(none, new feature)* | One W-2, box by box (see §5, Annual tax documents) |

Operations 1–5 are **required for a usable app**. 6–7 are required for correctness
for any employee who has ever received more than one check in a period. 8–11 are
feature parity with the current app and can follow. 12–13 are new: the legacy app
had no tax documents, so there is no SOAP method to point to, but Olympic Employee
Access already offers employees their annual tax documents, so the data exists.

---

## 4. Authentication — the important part

### How the legacy app worked

Login was **email address + last 4 digits of SSN**, escalating to the **full
9-digit SSN** after repeated failures. The app also sent a `deviceToken` and
`deviceType`.

### A security issue we will not reproduce

The legacy client **downloaded the employee's real SSN and compared it on the
device.** The new app does not do this and will not. SSN verification must happen
**server-side**; the API must never return an SSN, in full or in part, in any
response body.

We would rather hear "that's already how the new backend works" than discover it
isn't. Please confirm explicitly.

### What we need to know

- Is email + last-4-SSN still the authentication model on the new backend, or has
  Employee Access moved to real passwords / OTP / SSO?
- Is there a session token or bearer token, and what is its lifetime and refresh
  behaviour? The legacy service was stateless per call.
- Are `deviceToken` / `deviceType` still expected, and what are they used for?
- Is there a lockout or throttling policy we should respect client-side? The app
  currently escalates to full SSN after 2 failures and stops after 3 more.

### Request: a per-device token, for biometric sign-in

The app offers Face ID / fingerprint sign-in. Employee Access's own store listing
states *"Social Security and Account numbers are not stored on your device"*, and
we want to honour that same promise.

Doing so cleanly needs **one small addition**: on successful login, return an
opaque, revocable, per-device token, and accept that token in place of
credentials on subsequent logins. The app would store only that token in the
hardware-backed keychain/keystore, released after a biometric check.

Without it, the only way to offer biometrics is to keep the SSN in the device
keychain — encrypted, but still on the device, which contradicts the promise
above. **We would prefer the token.** If it's feasible, roughly what would it
take? If not, tell us and we'll ship the weaker option and flag the tradeoff.

---

## 5. Data the app consumes

Shown as JSON for readability. Field *names* are ours and easily remapped; field
*presence and meaning* is what we're asking about. `money` values are decimals in
dollars.

### Employee and employers (from `signIn`)

An employee may be paid by more than one company, and **has a different employee
id within each**. The app makes the employee choose an employer, then scopes every
later call to that choice.

```json
{
  "employee": { "id": "E-88214", "fullName": "MITCHELL, SARAH", "firstName": "Sarah" },
  "companies": [
    { "id": "CA-1041", "employeeId": "E-88214", "name": "Cascade Coffee Roasters", "latestPayrollId": "PR-90233" },
    { "id": "CA-2277", "employeeId": "E-90551", "name": "Northgate Catering Co.",  "latestPayrollId": "PR-90240" }
  ]
}
```

- `companies[].id` — client account id; scopes stub lookups
- `companies[].employeeId` — the employee's id **within that company**
- `fullName` is accepted as payroll stores it (`"LAST, FIRST"`); the app formats it

### Pay period summary (list rows)

```json
{
  "id": "H-20260718-regular-E-88214",
  "payDate": "Jul 18, 2026",
  "payDateIso": "2026-07-18",
  "net": 1643.20,
  "method": "Direct deposit",
  "isNew": true,
  "checkCount": 1,
  "isCombined": false,
  "sentId": "S-20260718"
}
```

- `id` — opaque to us; whatever you need to fetch the full stub
- `payDateIso` — a sortable date, any unambiguous format
- `method` — how the money arrived, e.g. `"Direct deposit"` or `"Paper check"`.
  The app labels the headline amount from this and will not claim a paper check
  was deposited. If a period mixes methods, send whatever reads correctly to an
  employee; the app treats anything without the word "deposit" as not a deposit.
- `isNew` — drives the unread badge; cleared by `markPaycheckRead`
- `checkCount` / `isCombined` — see §6
- `sentId` — the **delivery** id, required only for `markPaycheckRead` and
  `emailStub`. See the note below.

#### `id` and `sentId` are different things

`id` addresses a pay period or an individual check. `sentId` addresses a
*delivery* — one payroll sent to one employee. The app keeps them strictly
separate and will never substitute one for the other:

- A payroll with no delivery arrives with **no** `sentId`, and the app hides
  the "email a copy" action rather than guessing an identifier.
- Please make the API **reject** an `id` passed where a `sentId` belongs
  rather than accepting it. Silently accepting either is how a client ends up
  marking the wrong record read for months without anyone noticing.
- `sentId` must be scoped to the employee. Two people paid on the same date
  must not share one, or marking one payroll read clears the other's badge.

If historical payrolls need a *different* identifier to be re-emailed, say so
and we will extend the contract — we will not reuse the history id for it.

### Full pay stub

```json
{
  "id": "H-20260718-regular-E-88214",
  "payDate": "Jul 18, 2026",
  "method": "Direct deposit",
  "gross": 2452.50,
  "net": 1643.20,
  "earnings":   [ { "label": "Regular", "detail": "80.00 hrs · $30.00/hr", "amount": 2400.00 },
                  { "label": "Overtime", "detail": "1.17 hrs · $45.00/hr", "amount": 52.50 } ],
  "taxes":      [ { "label": "Federal income", "amount": 299.69 },
                  { "label": "Social Security", "amount": 152.06 },
                  { "label": "Medicare", "amount": 35.56 },
                  { "label": "State income", "amount": 118.95 } ],
  "deductions": [ { "label": "Health insurance", "amount": 68.00 },
                  { "label": "401(k) · 4%", "amount": 98.10 } ],
  "taxTotal": 606.26,
  "deductionTotal": 166.10,
  "ytd": { "gross": 36787.50, "net": 24648.00, "taxes": 9093.90, "deductions": 2491.50 }
}
```

Notes:

- **Earnings, taxes and deductions are open lists.** The app renders whatever
  labels you send and does not assume a fixed set — employees have different
  benefits, garnishments and local taxes. Do not collapse them into fixed fields.
- `detail` is optional per line (hours and rate, where applicable). **Where it
  states hours and a rate, those must multiply to the line amount as printed.**
  An employee reading "0.34 hrs · $45.00/hr" next to "$15.12" will call to ask
  why, and they will be right to.
- `method` is optional here; send it where a single delivery method applies, and
  omit it for a combined view spanning several.
- **The arithmetic must close.** `gross − taxTotal − deductionTotal` must equal
  `net`, and each section's line items must sum to its total. Employees check
  these by hand against the stub they're given, and a discrepancy of one cent
  becomes a support call.
- `ytd` is year-to-date **through and including this check**, across all of that
  employee's checks in that year.

### Annual tax documents (W-2)

`getTaxDocuments` lists one entry per tax year, for the employer being viewed:

```json
[
  { "id": "W2-2026-E-88214", "form": "W-2", "taxYear": 2026,
    "employerName": "Cascade Coffee Roasters", "status": "pending", "date": "Feb 1, 2027" },
  { "id": "W2-2025-E-88214", "form": "W-2", "taxYear": 2025,
    "employerName": "Cascade Coffee Roasters", "status": "available", "date": "Feb 2, 2026" }
]
```

`getW2` returns one issued form. These are the fixture backend's figures, summed
from the same pay stubs the app shows:

```json
{
  "id": "W2-2025-E-88214",
  "taxYear": 2025,
  "employee": { "firstName": "SARAH", "lastName": "MITCHELL",
                "address": ["118 Linden Avenue, Apt 2B", "Montclair, NJ 07042"],
                "ssnMasked": "XXX-XX-4821" },
  "employer": { "name": "Cascade Coffee Roasters", "ein": "07-3187654",
                "address": ["1200 Harbor Point Drive", "Fairfield, NJ 07004"] },
  "controlNumber": "2025-88214",
  "wages": 64488.41,
  "federalIncomeTax": 8201.92,
  "socialSecurityWages": 67118.65,
  "socialSecurityTax": 4161.36,
  "medicareWages": 67118.65,
  "medicareTax": 973.22,
  "socialSecurityTips": 0, "allocatedTips": 0, "dependentCareBenefits": 0, "nonqualifiedPlans": 0,
  "box12": [ { "code": "D", "amount": 2630.24 } ],
  "statutoryEmployee": false, "retirementPlan": true, "thirdPartySickPay": false,
  "box14": [ { "label": "UI/WF/SWF", "amount": 184.02 },
             { "label": "DI", "amount": 154.39 },
             { "label": "FLI", "amount": 221.50 } ],
  "states": [ { "state": "NJ", "employerStateId": "073-187-654/000",
                "wages": 64488.41, "incomeTax": 3255.27 } ]
}
```

Notes:

- **Fields follow the boxes of the printed form** (box 1 `wages`, box 2
  `federalIncomeTax` and so on), so each can be checked against a paper W-2.
- `box12` is up to four `{ code, amount }` pairs. `box14` labels are the
  employer's own; New Jersey employers print `UI/WF/SWF`, `DI` and `FLI` there.
  `states` holds one entry per state (boxes 15–20).
- **Only a truncated SSN.** `ssnMasked` must never carry the full number.
- `status` is `pending` until the form is furnished (by January 31 of the
  following year, or the next business day), so the app can say when to expect it.
- **If the payroll system already renders the official W-2 PDF, serving that is
  better than the box values alone.** Today the app draws the employee copies
  (B, C and 2) itself from these values, which works but is a second rendering of
  a legal document. With the official PDF, the app would show and share the exact
  form the employer issued.

---

## 6. Pay periods with more than one check

A period can hold several checks — a regular run plus a bonus, for example. The
legacy service handled this with two separate methods and the app relies on that
distinction:

- **`getChecksForDate`** — list the individual checks on a pay date, so the
  employee can open each stub separately.
- **`getCombinedStub`** — the same checks merged into a single stub.

The list row indicates which applies: `checkCount > 1` with `isCombined: false`
opens the list; `isCombined: true` opens straight into the merged view.

**Please confirm the new backend still distinguishes these.** If it only returns
combined totals, employees who receive separate checks will not be able to see
them individually, which is a functional regression against the current app.

---

## 7. Open questions

1. What is the base URL, and is there a non-production environment?
2. What authentication scheme does the new backend use? (§4)
3. Will the API return an SSN in any response? (It must not — §4)
4. Can you issue a per-device token for biometric sign-in? (§4)
5. Does the new backend still expose individual vs. combined checks? (§6)
6. Are earnings/taxes/deductions available as itemised lines, or only as totals?
7. Are YTD figures available per check, or must the client accumulate them?
8. Photos — still base64 in and out, or multipart upload and a URL back? Is there
   a size limit?
9. Does `SendEmail` still exist, and does it send to the payroll address on file?
10. Any rate limits, IP allow-listing, or API keys we need provisioned?
11. Can we get test credentials against non-production data? (§2, item 4)
12. Will `sentId` be rejected when a pay-period id is sent in its place, and is
    it scoped per employee? (§5)
13. Is `method` (direct deposit vs. paper check) available per check?
14. **W-2s:** does the payroll system already produce the W-2 PDFs that Olympic
    Employee Access shows? If so, can the API serve that PDF, alongside the box
    values or instead of them? (§5)
15. How many years of W-2s are kept, and are corrected forms (W-2c) served the
    same way? What `form` value do they carry? For now the app lists W-2s only
    and leaves out anything else (a W-2c, a 1099) rather than failing the list.
16. Can the W-2 carry a truncated SSN (`XXX-XX-1234`)? The IRS allows this on
    employee copies, and the app must never receive the full number.
17. Is the employee's consent to receive W-2s electronically already recorded
    (for example through Paperless Payroll sign-up)? The IRS requires it before a
    W-2 is furnished electronically, and the app should only offer W-2s to
    employees who have given it.
18. From the 2026 form, box 14 splits into 14a and 14b and box 12 gains codes TA,
    TP and TT (tips and qualified overtime). Will the API send those as they
    print? For 2025, is qualified overtime being reported in box 14?

---

## 8. Error handling

The app distinguishes these cases and shows different copy for each. Any scheme
works — HTTP status codes, an error field, a fault — as long as they're
**distinguishable from one another**, because "something went wrong" is a poor
message when the real problem is a typo in an email address.

| Case | What the employee is told |
|---|---|
| Email not recognised | Check the email address and try again |
| SSN doesn't match | Check the digits and try again |
| Email shared by several employees | Call Olympic Payroll (with the count, if known) |
| Record not found | We couldn't find that pay stub |
| Sign-in no longer accepted | Signed out, and sent back to sign in again |
| Network failure | Check your connection |
| Server error | Generic apology — no internal detail shown |

Underlying error text is never displayed to the employee, so please feel free to
return whatever diagnostic detail is useful to us in logs.

---

## 9. How the app selects a backend

The app picks its backend from configuration, not from an edited source file:

- `EXPO_PUBLIC_API_URL` (or `extra.apiUrl` in `app.json`) names the real
  payroll service. When it is set, the app talks to that service through the
  HTTP adapter (`src/api/http.ts`) and the demo banner disappears. When it is
  absent the app runs on fixtures and shows the banner. The two are never mixed.
- The `production` EAS profile does not set `EXPO_PUBLIC_API_URL` yet; add it to
  that profile's `env` once the URL is known. Until then, a production build
  **throws at startup** rather than shipping invented payroll to employees.
- The `preview` profile sets `EXPO_PUBLIC_ALLOW_FIXTURES=1`, so internal demo
  builds keep working on fixtures while this contract is being agreed.

So the single thing needed to switch the app onto the real service is the URL.
The adapter is already written (§10, §11).

---

## 10. What happens on our side once we have this

The app is built against a single interface (`PayrollApi`, in
`OlympicPaycheckExpo/src/api/client.ts`) that every screen depends on. No screen
knows anything about the transport.

**The HTTP adapter is already written** (`OlympicPaycheckExpo/src/api/http.ts`),
against the contract in §11. It already handles sign-in with a bearer token,
sign-out, request timeouts, the error cases in §8, and checks every response
before a screen sees it, so a malformed reply becomes a clear error rather than
a crash. Connecting to the real service means:

1. Set `EXPO_PUBLIC_API_URL`.
2. Where your API differs from §11, adjust the paths (`ROUTES`) and the field
   readers in `http.ts`. No screen changes.
3. Run the contract tests against a test account.

The test suite includes contract tests that run against whatever the adapter
returns, so the same tests that pass on fixtures today become the acceptance
tests for your API.

Realistically: a day or two to adapt the adapter to a documented API, then
verification against real accounts.

---

## 11. The contract the app speaks today

This is a proposal, and the paths are ours. If your API is shaped differently,
nothing needs to change on your side: the differences are absorbed in one file
on ours.

**Conventions**

- JSON over HTTPS, under a configurable base URL.
- `POST /auth/sign-in` returns `{ "token": "…", "employee": {…}, "companies": [ … ] }`
  (§5). Every later request sends `Authorization: Bearer <token>`. The token is
  held in memory only, never on the device's disk.
- A `401` on any request after sign-in ends the session: the app signs the
  employee out once and returns to the login screen.
- Errors are any non-2xx status with an optional body
  `{ "error": { "code": "…", "count": 3 } }`, where `code` is one of
  `INVALID_EMAIL`, `INVALID_SSN`, `MULTIPLE_EMPLOYEES`, `NOT_FOUND` or
  `SESSION_EXPIRED`. Without a code, the app goes by the status: `401` while
  signing in is a wrong SSN, `401` afterwards is an ended session, `404` is not
  found, anything else is a generic server error.
- Money may be a JSON number or a decimal string (`"1643.20"`). Ids may be
  strings or numbers. Yes/no fields may be `true`/`false` or `1`/`0`.
  Addresses may be a list of lines or one string with a line break per row.
- Dates are ISO (`2026-07-18`). The display date (`payDate`) is optional on pay
  periods and stubs alike; without it the app formats the ISO date itself.
- A request that has not answered in 20 seconds is treated as a connection
  failure.
- An SSN in any response is truncated to the last four digits before any screen
  or PDF can see it, but please don't send one.

**Endpoints**

| Operation | Method and path | Body | Returns |
|---|---|---|---|
| `signIn` | `POST /auth/sign-in` | `{ email, ssnLast4 }` or `{ email, ssnFull }` | token, employee and companies (§5) |
| `signOut` | `POST /auth/sign-out` | none | nothing |
| `getLatestPaycheck` | `GET /employees/{employeeId}/paychecks/latest` | none | pay period summary |
| `getPayYears` | `GET /employees/{employeeId}/pay-years` | none | `[2026, 2025, …]` |
| `getPaychecks` | `GET /employees/{employeeId}/paychecks?year={year}` | none | pay period summaries |
| `getStub` | `GET /companies/{companyId}/stubs/{paycheckId}` | none | full pay stub |
| `getChecksForDate` | `GET /employees/{employeeId}/pay-dates/{payDateIso}/checks` | none | pay period summaries |
| `getCombinedStub` | `GET /employees/{employeeId}/pay-dates/{payDateIso}/combined-stub` | none | full pay stub |
| `markPaycheckRead` | `POST /deliveries/{sentId}/read` | none | nothing |
| `emailStub` | `POST /deliveries/{sentId}/email` | none | nothing |
| `getPhoto` | `GET /employees/{employeeId}/photo` | none | `{ url }`, `{ base64 }` or `null` |
| `uploadPhoto` | `PUT /employees/{employeeId}/photo` | `{ base64 }` | nothing |
| `getTaxDocuments` | `GET /employees/{employeeId}/tax-documents` | none | tax documents (§5) |
| `getW2` | `GET /employees/{employeeId}/tax-documents/{documentId}/w2` | none | one W-2 (§5) |

Credentials only ever travel in a request body, never in the address, because
addresses end up in server logs.

---

## 12. What the Olympic Payroll web app already does

We read the public code of the myolympicpay.com web app to see how it talks to
its backend. No requests were made to the API itself. It suggests much of what
the mobile app needs already exists:

- **The same style of API.** JSON calls under versioned paths (`v0/…`, `v2/…`)
  on a configurable service URL, authorised with `Authorization: Bearer`
  tokens from an ASP.NET identity sign-in. The mobile adapter already works
  this way.
- **Pay stub PDFs for employees.** `POST v0/misc/getESSEmpCheckReports/{id}`
  returns a PDF.
- **W-2 PDFs.** `POST v0/hr/getW2Reports/{id}` returns a PDF, and
  `GET v0/misc/getW2StatusList` lists W-2 status.
- **Sign-in through a token endpoint.** The web app gets its bearer token from
  `POST TokenPKey`, a form-encoded OAuth-style request (`grant_type=password`),
  and has a matching refresh call. The mobile adapter's sign-in (§11) can be
  pointed at the same endpoint.
- **One login, several employers.** `v2/login/getEmployeeAspnetUser` returns
  the employee records linked to a login, each then loaded with
  `getEssEmployee`. That is the same shape as the app's employer picker.
- **Sign-in bookkeeping.** `v2/login/getUserLoginCounter`,
  `incrementUserLoginCounter` and `resetUserLoginCounter` (a failed-attempt
  counter), and `v0/account/PutFinalizeEssLoginAccount` (employee self-service
  accounts).
- **A configured session timeout.** `v2/session/GetSessionTimeoutConfiguration`.
- **Profile photos.** `v0/hr/uploadEmployeePhoto`.

What this raises for you:

1. Can the mobile app use the same service URL and the employee self-service
   sign-in, rather than a separate API?
2. If the official pay stub and W-2 PDFs can be served to the app, it will show
   and share those exact documents instead of drawing its own copies.
3. Should the app respect the same failed-attempt counter as the web sign-in?
4. The app signs out after 5 idle minutes. Should it follow the timeout the web
   app is configured with instead, and use the refresh call to keep an active
   session alive?
5. When one login covers several employers, does a single token authorise every
   linked employee record, or does switching employer need a new token or an
   employer-specific header? The app switches employer without signing in
   again.

---

*Questions to the mobile side, or to walk through the app as it stands — it's
installable on Android today.*
