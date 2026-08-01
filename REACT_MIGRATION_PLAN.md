# Olympic Paycheck → React (Expo) Rebuild Plan

**Project:** Rebuild the legacy iOS "Olympic Paycheck" app in React Native (Expo)
**Duration:** 8 weeks · 20 hrs/week · ~160 hours total
**Roles:** The developer owns the implementation and testing on real devices. Olympic Payroll management supplies decisions, credentials, test accounts, store accounts and sign-off.

> This is the plan written at the start of the project (July 2026). For what was actually built, how it works, and where things stand today, see [README.md](README.md).

---

## 1. What the legacy app actually is (analysis findings)

The old app is **Objective-C, iPhone-only, portrait-only, v1.2.4**, originally built 2013–2014. It is an **employee self-service pay-stub viewer**, not a payroll processor. Core flow:

1. **Login** with email + last 4 digits of SSN (escalates to full 9-digit SSN after repeated failures).
2. Fetch the employee's company account(s). If they work for **multiple companies**, they pick one.
3. **Report Options hub**: view *Latest Payroll* or *Previous Payrolls*.
4. Drill into a pay period → see the **pay stub detail** (earnings, deductions, taxes, **Net Pay**, **YTD**), including **multiple-check** and **combined-check** cases.
5. Optional **profile photo** capture/upload.
6. "Remember me," time-of-day greeting, and an auto-logoff timer.

### Backend (the important part)
All data comes from a **SOAP/XML web service** that returns JSON embedded in the SOAP body:

- Base URL: `https://myolympicpay.com/WebServices/EmplPayrollInfo.asmx`
- Photo download: `https://myolympicpay.com/DownloadPhotos.ashx?EmpID=<id>`

**SOAP methods the app calls** (these define our API layer):

| Method | Inputs | Purpose |
|---|---|---|
| `GetClientAccountsInformations` | emailAddress, ssn, deviceToken, deviceType | Login / auth + company accounts |
| `GetLatestPayroll` | strEmpID | Most recent pay stub |
| `GetPayrollYears` | strEmpID | Years available for history |
| `GetPayrollHistory` | strEmpID (+ strYear) | Pay periods for a year |
| `GetEmployeePayrollDetails` | strClientAccountID, strHistID | Full stub detail |
| `GetMultipleCheckList` | strEmpID, strCheckDate | List when a period has >1 check |
| `GetEmpCombinedPayroll` | strEmpID, strCheckDate | Combined-check view |
| `FlagReadPayrolls` | strSendID | Mark latest payroll as read |
| `SendEmail` | strSendID | Email a stub |
| `GetEmployeePhoto` | strEmpID | Fetch profile photo |
| `InsertBase64Photo` | strEmpID, strBase64String | Upload profile photo |

### Screen inventory (~15 controllers to recreate)
Login · Privacy Policy · Terms of Use · Company/Client selection · Report Options hub · Year list · Previous payrolls list · Check list (current) · Check list (previous) · Current payroll main (tab bar) · Net tab · YTD tab · Pay stub detail · Photo capture.

### Legacy brand colors found in the code (starting point only)
- Net-pay green/teal: `#05C596` (rgb 5,197,150)
- Accent blue: `~#1B75BB` (rgb 27,117,187)
- These get **replaced** by the current App Store palette (see Decision D2).

---

## 2. Decisions & status

- **D1 — Legacy SOAP endpoint: ❌ DECOMMISSIONED (probed 2026-07-22).**
  The exact endpoint the old app used — `myolympicpay.com/WebServices/EmplPayrollInfo.asmx` (and the `www` variant) — **no longer serves the SOAP service.** A GET returns the company's new Angular website; a **POST returns IIS `405 - HTTP verb not allowed`** (a live ASMX would return a SOAP response or fault, not 405). The company has migrated `myolympicpay.com` to a modern Angular site + a new backend, and ships a newer app (**Olympic Employee Access**) on that new backend. **The employee data still exists — but behind a new, different API we do not yet have the contract for.** *This is the D1 risk materializing; caught in the Week-1 probe exactly as planned.*
  **➡ Needed from management:** the **current backend** the modern apps use — base URL, API docs/contract (Swagger/Postman/WSDL), and auth scheme. The new app targets that, not the retired ASMX.
- **D3 — Platforms: ✅ RESOLVED — iOS + Android, both.**
  One Expo codebase ships to **both** the App Store and Google Play. Same app, tested on a real Android device as well in Weeks 6–8 (already budgeted).
- **D2 — New color palette / brand. 🟡 PROPOSED (needs sign-off).** Researched from the company's live properties (see §9). Proposed palette below, derived from the Olympic Payroll brand blue `#0269C2`. Management to confirm, or hand over an official brand guide, before Week 7.
- **D4 — Auth parity vs. improvement.** The legacy login is email + last-4-SSN — weak for payroll/PII data. Keep exact parity (fastest, matches backend) or add a real password / OTP layer later? Default assumption: **keep parity now**, security hardening as phase 2.
- **D5 — Apple + Google developer accounts.** Who owns them, and can the developer get access for EAS build/submit in Week 8? Both stores now — Apple ($99/yr) and Google Play ($25 one-time). Store review takes days, so start this early.

---

## 3. Target architecture (the new stack)

- **Expo (managed workflow)**, pinned to **SDK 54.0.36** (React Native 0.81.5, React 19.1.0) — no native Xcode juggling; handles camera, secure storage, builds via EAS. Docs: https://docs.expo.dev/versions/v54.0.0/
- **TypeScript** throughout.
- **Expo Router** (file-based navigation) — clean replacement for the storyboard's segues.
- **TanStack Query (React Query)** for all server state (caching, loading/error states, retries) — replaces the manual `NSURLConnection` + XML-parser-delegate code.
- **SOAP client shim**: a small typed module using `fetch` + `fast-xml-parser` that builds the SOAP envelopes and parses the JSON-in-XML responses. One function per method in the table above. *(Not built: the SOAP service turned out to be retired — see D1. The app talks to the new backend through an HTTP/JSON adapter instead.)*
- **expo-secure-store** for "remember me" (email only — **never** persist SSN).
- **expo-local-authentication** for **Face ID / Touch ID / Android fingerprint** login (see §8).
- **expo-camera / expo-image-picker** for the photo feature; base64 upload.
- **Theming**: a single design-token file (colors, spacing, typography) driving all components, so D2's palette swaps in one place. Custom themed components (Button, Card, StatRow, etc.) for the "fresh new look."
- **EAS Build + EAS Submit** for CI builds and store submission.

---

## 4. The 8-week schedule (20 hrs/week)

Each week lists the **build** work and the **review** work (testing and decisions), plus the deliverable. Hours are the ~20/week budget.

### Week 1 — Discovery, project setup, design foundation (~20h)
- **Build:** Scaffold the Expo + TypeScript + Expo Router project; set up linting/formatting, folder structure, and the design-token system (placeholder palette). Write the **backend probe script** to validate D1. Build the SOAP client shim skeleton + types for all 11 methods.
- **Review:** Provide a **real test login** (email + last-4 SSN) so the live backend can be exercised. Chase D1, D2 (palette), D5 (dev accounts). Confirm platform scope (D3).
- **Deliverable:** Running empty app on a phone (Expo Go), + a report on which SOAP methods actually respond.

### Week 2 — API layer + authentication flow (~20h)
- **Build:** Implement + test every SOAP call against the live backend. Build the Login screen (email + SSN, the last-4→full-SSN escalation, validation, remember-me, greeting), auth state, and secure storage.
- **Review:** Test login on device with real accounts (valid, invalid email, wrong SSN, multi-company). Report backend quirks.
- **Deliverable:** Log in and pull real company/account data.

### Week 3 — Navigation shell + hub + company selection + biometric login (~20h)
- **Build:** App navigation (stacks/tabs), Report Options hub, multi-company selection screen, auto-logoff timer, Privacy Policy + Terms screens, logout. **Biometric (Face ID / fingerprint) unlock** built on top of Week 2's login (see §8).
- **Review:** Test single- vs multi-company accounts; verify logoff behavior; test Face ID (iPhone) and fingerprint (Android) enroll + unlock + fallback.
- **Deliverable:** Full navigation skeleton — every screen reachable — plus one-tap biometric sign-in after the first login.

### Week 4 — Previous payrolls: years, periods, check lists (~20h)
- **Build:** Year list, previous-payrolls list, and the multiple-check / combined-check list screens, wired to `GetPayrollYears` / `GetPayrollHistory` / `GetMultipleCheckList` / `GetEmpCombinedPayroll`.
- **Review:** Test against employees with multiple years, multiple checks, and combined checks (edge cases from real data).
- **Deliverable:** Full drill-down through pay history.

### Week 5 — Pay stub detail + current payroll + Net/YTD tabs (~20h)
- **Build:** The pay-stub detail screen (earnings, deductions, taxes, net pay), the current-payroll main screen with **Net** and **YTD** tabs, and the "new/unread" badge + `FlagReadPayrolls` behavior.
- **Review:** Compare the rendered stub numbers **line-by-line** against the legacy app / web portal for correctness.
- **Deliverable:** Accurate, readable pay stubs end-to-end.

### Week 6 — Photo capture/upload + remaining features + edge cases (~20h)
- **Build:** Profile photo capture (camera + library), base64 upload (`InsertBase64Photo`), photo fetch/display; email-a-stub (`SendEmail`); handle all loading/error/empty states and network failures.
- **Review:** Test camera permissions and upload on real devices; verify error messages.
- **Deliverable:** Feature-complete app at parity with the legacy version.

### Week 7 — Rebrand, polish, accessibility (~20h)
- **Build:** Apply the confirmed palette (D2) across the token system, refine typography/spacing/animations for the "fresh new look," add app icon + splash, dark-mode-safe colors, and accessibility (font scaling, contrast, screen-reader labels).
- **Review:** Management design review — sign-off on the look.
- **Deliverable:** Visually finished app matching the brand.

### Week 8 — QA, builds, store submission, buffer (~20h)
- **Build:** Bug-fix pass, EAS build config, production builds, store metadata/screenshots, privacy declarations (SSN handling matters here), submission.
- **Review:** Full regression test on multiple devices; final sign-off; submit with the company's developer accounts.
- **Deliverable:** Builds submitted to the App Store (and Play Store if D3 = both). Buffer absorbs slippage.

---

## 5. How the work is organised

- **Review time each week** goes to testing on real devices, supplying real test logins and edge-case accounts, management reviews, accounts and credentials, and decisions.
- **Each week ends** with reviewable code and a running app installed on a phone (Expo Go or an internal build).
- **Fastest feedback loop:** real (test) accounts early. This app is driven entirely by live backend data, so screens cannot be fully verified without real responses.
- **Weekly checkpoint:** install the build, run the test checklist, report back, and adjust the next week from there.

---

## 6. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Backend method missing data we need | Medium | Backend team exposes it via a web-service method — small task, not app-side |
| No brand assets by Week 7 (D2) | Medium — rework | Build on tokens so reskin is a 1-file change; chase early |
| App Store review delays | Medium | Start dev-account access + privacy declarations in Week 1, submit early in Week 8 |
| SSN/PII handling scrutiny | Medium | Never persist SSN; document data handling; flag phase-2 auth hardening |
| Undocumented backend edge cases | Medium | Real-account testing every week, not just at the end |

---

## 7. Out of scope (flag to management)
- Any **backend/API changes** (assumes reuse of the existing SOAP service).
- **Payroll processing / admin** features — this is employee-view only, same as the original.
- **Auth hardening** (real passwords/MFA) — recommended as a **phase 2**.
- Push notifications (the legacy app had them stubbed out but disabled).

---

## 8. Biometric login (Face ID / Touch ID / fingerprint)

**Goal:** after the employee signs in once on their device, subsequent opens use Face ID (iPhone) / fingerprint (Android) instead of re-typing email + SSN — the modern standard.

**The design tension to solve:** the company's own modern app advertises _"Social Security and Account numbers are not stored on your device."_ Our backend only authenticates with email + last-4-SSN (there's no session token). So we must NOT just save the SSN on the device. Two ways to do biometric cleanly:

- **Option A (recommended) — backend issues a device token.** On first successful login, the web service returns (or we add a method that returns) a per-device token. We store only that token in the hardware-backed keychain/keystore, gated by biometrics. On next open, Face ID/fingerprint unlocks the token → silent re-auth. No SSN on device. *Requires a small backend method from the company's team — ties into the "backend can expose methods later" note in §2.*
- **Option B (no backend change) — encrypted credential vault.** Store the email + last-4-SSN in the OS secure enclave (`expo-secure-store`, hardware-encrypted), released only after a successful biometric check, then replayed to the existing login call. Works today with zero backend work, but it *does* keep the SSN on-device (encrypted), which conflicts with the marketing claim above.

**Recommendation:** ship **Option B** in this 8-week build so biometrics work immediately, and flag **Option A** as the clean follow-up once the backend team can add a token method. Either way:
- Biometric is **opt-in** (prompt after first login: "Enable Face ID for faster sign-in?").
- Always keep the manual email + SSN path as fallback (biometric fails, new device, etc.).
- Auto-logoff and "remember me" still apply.

Built in **Week 3** on top of the Week 2 auth flow, using `expo-local-authentication` (handles Face ID, Touch ID, and Android BiometricPrompt with one API).

---

## 9. Brand & palette research (the company's other apps)

**The company's app catalog (Apple developer "Olympic Payroll", id 882047990):**
- **Olympic Paycheck** (id 882047987) — the legacy app being rebuilt (iOS 12+).
- **Olympic Employee Access** (id 6443957124) — the **newer, modern app** (iOS 14+, also on Google Play as `com.olympicpayroll.mobileapp`). This is the app whose look we align with: it adds time-off requests, tax docs, onboarding, tasks, profile, chat. Its store copy states _"Social Security and Account numbers are not stored on your device"_ → drives the biometric design in §8.
- Web properties: `olympicpayroll.com` (marketing), `myolympicpay.com` / `ess-myolympicpay.com` (employee self-service portal), `partners.olympicpayroll.com`.

**Palette derived from the live brand (marketing site + legacy app + ESS portal all converge on a strong blue):**

| Role | Hex | Source / notes |
|---|---|---|
| **Primary — brand blue** | `#0269C2` | Dominant color on olympicpayroll.com nav/buttons/headings; matches legacy app blue (`#1B75BB`) & ESS Material blue (`#1976D2`) |
| Primary dark (headers, pressed) | `#024E92` | Darker shade of primary |
| Primary tint (selected bg, chips) | `#E7F1FB` | Light wash of primary |
| **Accent — money / net pay (positive)** | `#05C596` | Heritage teal-green the legacy app used for Net Pay amounts |
| Torch red (logo only, use sparingly) | `#D9534F` | From the Olympic-torch logo flame; avoid as UI accent (reads as error) |
| Ink / primary text | `#212529` | |
| Secondary text | `#565656` | From marketing site |
| Borders / dividers | `#CACACA` | |
| App background | `#F8F9FA` | |
| Surface / cards | `#FFFFFF` | |
| Error | `#DC3545` | |
| Warning | `#FFC107` | |

Logo: Olympic **torch** — red flame over a blue base on white (`olympicpayroll.com/Media/Default/Photos/logo_long_handle.png`).

**Design direction:** clean, modern fintech feel — white cards on a light-gray background, `#0269C2` for primary actions/headers, teal-green `#05C596` reserved for net-pay/positive figures, generous spacing and large legible numbers for pay amounts. All of this lives in one design-token file, so when the palette is confirmed (or an official brand guide is supplied) the whole app re-themes from a single place.

> **Caveat:** these hexes are sampled from the company's live websites, not an official brand book. Treat as a strong, on-brand starting point — to be confirmed, or replaced with the real spec, before Week 7.

---

_Plan drafted from a full read of the legacy Objective-C source, plus research of the company's App Store catalog and web properties. The decisions in §2 were updated as answers came in._
