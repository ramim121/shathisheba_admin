# Shathi Sheba — Open Issues Register

Everything found, flagged or deliberately deferred across both repositories that
is **not yet resolved**. Anything already fixed is in git history and in
`SECURITY.md`, not here.

Last updated: 2026-08-17.

Severity: 🔴 blocks pilot · 🟠 fix before scale · 🟡 quality/maintenance · 🔵 nice to have

---

## 1. Needs a human — cannot be fixed in code

### 1.1 🟠 Vercel cannot reach RDS — network, not configuration

The environment variables were the first half of this and are now **fixed**: the
project had **zero** variables set (confirmed via `vercel env ls`), because the
old README documented `DATABASE_URL` / `NEXTAUTH_*`, none of which the code reads.
All fifteen `MYSQL_*` / S3 / SMS / OTP variables are now set across Production,
Preview and Development, and the deployment has been rebuilt.

After that fix the finance routes answer **401** rather than 404 — so the code is
current and the runtime is healthy — but the database routes still return 500:

| Route | vercel.app | EC2 / localhost |
|---|---|---|
| `/api/v1/catalog` (static array, no DB) | 200 | 200 |
| `/api/v1/geo/divisions` | **500** | 200 |
| `/api/v1/app/finance/loan-products` | 401 (was 404) | 401 |

The remaining cause is network. This laptop and the EC2 box both connect to RDS,
Vercel does not, so the RDS security group admits specific addresses and Vercel's
function egress is not among them. Vercel egress is dynamic unless you buy static
IPs, so there is no small CIDR to add.

**This is not on the critical path.** `shathisheba.digigramventures.com` — the
address the APK is built against — is the EC2 box, which reaches RDS fine. Vercel
is a spare.

**Action (choose one, none urgent):**
1. Leave it. Treat Vercel as a build-preview target only.
2. Buy Vercel static egress IPs and allow those in the RDS security group.
3. Allow `0.0.0.0/0` on 3306 — **do not**, unless RDS is first put behind
   IAM auth or a proxy. It exposes the database to the internet.

### 1.2 🔴 GitHub token in plaintext in the server's git remote

`/var/www/html/shathisheba-admin` had its `origin` set to
`https://ramim121:ghp_…@github.com/ramim121/shathisheba_admin`. Any process that
can run `git remote -v` there — or read `.git/config` — gets a working GitHub
credential. The repository is public, so `git fetch` never needed it.

The remote has been rewritten to the plain HTTPS URL. **The token itself is still
live and must be revoked.**

**Action:** revoke it at github.com/settings/tokens. If the server ever needs to
push, use a deploy key (`ssh-keygen` + repo → Settings → Deploy keys) rather than
a PAT in a URL.

### 1.3 🔴 WeatherAPI key is public in git history

`.env` was committed to the **mobile** repo in commit `5950fd5`, which is on
`origin/main` of a public GitHub repository. Removing the file later did not
remove the blob.

| Key | Status |
|---|---|
| `EXPO_PUBLIC_WEATHERAPI_KEY` | **still live — rotate** |
| `GEMINI_API_KEY` / `EXPO_PUBLIC_GEMINI_API_KEY` | already rotated |

**Action:** rotate at weatherapi.com first — that is what ends the exposure.
History purge (`git filter-repo --path .env --invert-paths`) is optional damage
limitation and forces everyone to re-clone.

### 1.4 🔴 Provider keys are compiled into the mobile binary

`EXPO_PUBLIC_*` values are baked into the JS bundle and extractable from any
distributed APK. Rotation does not help — the next build embeds the new value.
Affects `EXPO_PUBLIC_GEMINI_API_KEY` and `EXPO_PUBLIC_WEATHERAPI_KEY`.

**Action (architectural):** proxy Gemini and WeatherAPI through the backend so the
phone calls `/api/v1/...` with its session token. `src/ai/gemini.ts` was extracted
partly to make this a single-file change.

### 1.6 🟠 mPowerU has no sandbox, so the only driver is a stub

EcoDev have not supplied API credentials or a test environment. The adapter,
session store, idempotency, webhook verification, polling fallback, pseudonymous
respondent ids and the factor-level role restriction are all built and tested —
against a **stub driver that invents scores**.

`assertDriverUsableHere` refuses the stub when `NODE_ENV=production` unless
`MPOWERU_ALLOW_STUB_IN_PRODUCTION=true`, so it cannot reach real applicants by
accident. That guard is the only thing standing between a pilot and a farmer
being graded on a number derived from a hash of their session id.

**Action (needs EcoDev):** obtain sandbox credentials, the real scale for
`normaliseBand`, the webhook signature scheme, and written confirmation of what
factor-level output the contract permits exporting (`ADM-LON-24`). Then add
`lib/mpoweru/drivers/ecodev.ts` and set `MPOWERU_DRIVER`. Nothing that calls the
adapter needs to change.

Until then the behavioural criterion is worth 20 of the 100 points and will read
as no-data on every real application — rated 0 and flagged, which is the correct
behaviour but does cap everyone's achievable score at 80.

### 1.7 🟡 The lender pack is CSV and printable HTML, not a generated PDF

`ADM-LON-27` asks for PDF and CSV with Bangla rendering correctly in both. The CSV
is there, with a UTF-8 BOM so Excel opens Bangla rather than mojibake. "PDF" is
served as a self-contained printable page rather than a generated binary.

That was a deliberate trade. Generating a PDF with Bangla needs an embedded
OpenType font carrying the right shaping tables — several megabytes in the
bundle, and a failure mode where conjuncts render as boxes **only for the people
who read Bangla**, which is precisely the group least likely to be the one
testing it. Printing from a browser uses the reader's own system font and is
correct by construction.

**Action if a binary PDF is required for a lender's process:** bundle Noto Sans
Bengali and render server-side, and test the output with a Bangla reader before
shipping it — not by eye in a Latin-script locale.

### 1.5 🟡 `middleware.ts` is deprecated in Next 16

Next 16 renamed the convention to `proxy`. The build warns but still routes it
correctly (`ƒ Proxy (Middleware)` appears in the build output), so nothing is
broken. It will stop working in a future major.

**Action:** `npx @next/codemod@canary middleware-to-proxy .` — mechanical, but it
touches the auth boundary, so do it deliberately with the auth tests to hand
rather than as a drive-by.

---

## 2. Security work deferred by decision

Deferred with agreement on 2026-08-16 as appropriate while testing with your own
data. All become required before real applicant data is captured.

| ID | Item | Severity |
|---|---|---|
| SEC-18 | NID numbers stored in plaintext. Spec requires AES-GCM at rest with masked display (`•••• •••• 1234`) everywhere except one audit-logged admin view | 🔴 before pilot |
| SEC-13 | Session token lives in `AsyncStorage` (unencrypted). Spec requires `expo-secure-store` | 🟠 |
| — | Session tokens are stored raw. Spec requires a SHA-256 hash with constant-time comparison | 🟠 |
| SEC-14 | Finance responses are not yet excluded from the `apicache:` AsyncStorage cache. Loan applications, financial profiles, debt and assessment results must be memory-only | 🟠 before pilot |
| SEC-15 | KYC presign window is longer than the 60 s the spec requires | 🟡 |
| SEC-19 | Retention/purge job not built: declined 24 months then anonymise, behavioural 24 months, KYC documents 5 years, readiness indefinite. Build with a dry-run mode | 🟠 |
| SEC-10 | `EXPO_PUBLIC_API_BASE_URL` is plain HTTP in dev; production builds should reject non-HTTPS at startup | 🟠 |

---

## 3. Finance features — specified but not built (phases P3–P6)

Phases P1 (Readiness) and P2 (loan intake + pricing) are complete and documented
in [`docs/finance-features.md`](docs/finance-features.md). What remains from
`SRS-FIN-01 v1.2`:

**P4 (the 100-point scorecard) is complete** — engine, configuration, hard stops,
pathways, reason codes, overrides, immutable assessments and the shadow-mode
flag, verified by 95 unit tests and 41 end-to-end checks. **P3's data model is
complete**; what remains of P3 is the admin UI to capture into it.

| Phase | Scope | Severity |
|---|---|---|
| P3 | **Done**: workspace at `/loan/applications/{id}`, computed requirement checklist, evidence capture with provenance, the 11-item field verification with the contradictory-verdict rule, repeating-row editors for assets/debt/documents/visits, development-plan assignment. **Outstanding:** the address and extended-KYC capture sections (captured today through the existing KYC surfaces), real file upload wired to the S3 presign route (the row editor currently records a key), and offline tablet drafts | 🔵 |
| P4 | **Done**: engine, configuration screens, and the farmer-facing `loanResult`, `developmentPlan` and `assessmentHistory`. **Outstanding:** the champion/challenger comparison view — `is_shadow` and a `shadow` model status exist, nothing renders the comparison | 🔵 |
| P5 | **Adapter done, provider not connected.** `lib/mpoweru/adapter.ts` with a stub driver, session orchestration, idempotency, webhook + polling, pseudonymous respondent ids, factor-level role restriction and normalisation. **Blocked on EcoDev supplying a sandbox** — see 1.6. Mobile `mpowerUAssessment` screen not built, since there is nothing for a farmer to open yet | 🟠 |
| P6 | **Done**: disbursement with snapshotted terms, schedule generation, oldest-first repayment allocation, arrears recomputation, collections, the farmer's `loanAccount` screen, lender packs and submissions with consent gating and structured declines, and the notification queue. **Outstanding:** the pack is CSV + printable HTML rather than a generated binary PDF (see 1.7), and notifications are dispatched on demand rather than by a scheduler (see 5) | 🔵 |

Mobile screens specified but not yet added: `mpowerUAssessment` (P5),
`loanAccount` (P6), `loanConsentManage`, `loanReviewRequest`.

Nothing else from this pass is outstanding — the API viewer regrouping, the
dashboard loan-pipeline card and `ADM-RDY-02` are all in section 6.

---

## 4. Pre-existing platform gaps (from the 2026-08-13 audit)

Still open, unrelated to the finance work:

| Ref | Gap | Severity |
|---|---|---|
| GAP-06 | No offline write queue — work composed offline is lost, not retried | 🟡 |
| GAP-03 | Composite-key resources resolve by partial key: `user/interests` and `learning/progress` can address the wrong row via `?id=` | 🟠 |
| GAP-12 | No CI. Tests exist (`scripts/test-finance-engines.mjs`, 46 cases) but nothing runs them automatically | 🟠 |
| GAP-11 | Accessibility unverified. New finance screens use ≥56 dp targets and `accessibilityLabel` on icon-only controls, but nothing has been audited | 🟡 |
| GAP-10 | `App.tsx` is ~7,950 lines. Theme, types, AI and API layers were extracted; the ~110 screen components remain | 🟡 |
| GAP-05 | Order district/upazila now come from the profile, but other hard-coded fallbacks may remain | 🔵 |
| — | Seed/fallback datasets still power some app surfaces on fetch failure (GAP-08). Credit surfaces are exempt by design | 🟡 |
| — | No per-column schema validation on writes — only shape/size guards | 🟡 |

---

## 5. Environment and operational notes

- 🟡 **The machine's LAN IP has changed repeatedly** (`192.168.1.101` →
  `.1.105` → `192.168.249.146`). `EXPO_PUBLIC_API_BASE_URL` in the mobile `.env`
  must be rechecked whenever the phone cannot connect.
- 🟡 **`OTP_DEV_MODE=false`** means test runs send real SMS and spend credits.
  Set it to `true` before running the E2E suites. This now also governs repayment
  reminders — `admin/loan/notifications/dispatch` sends real messages.
- 🟠 **Nothing schedules the finance jobs.** `admin/loan/arrears/refresh`,
  `admin/loan/notifications/queue`, `admin/loan/notifications/dispatch` and
  `admin/loan/mpoweru/poll` are all endpoints an admin has to press. Days-past-due
  is a function of the calendar and goes stale on its own, so until a scheduler
  calls these nightly, arrears are only as current as the last person who
  remembered. A cron on the EC2 box hitting the four endpoints with an admin
  session is enough; the endpoints are idempotent and deduplicated by design.
- 🟡 `expo@54.0.35` is installed; Expo expects `~54.0.36`.
- 🔵 A React duplicate-key warning appears on some admin management tables.
  Cosmetic, but it means list rows are not uniquely keyed.
- 🔵 Migration `020` onwards is applied to the live RDS instance directly.
  There is no migration-tracking table — applied state is inferred from schema
  probes. Fine while idempotent, but worth a `schema_migrations` table.
- 🔵 Commit `f1c326c` quoted a **retired** database host and username in this
  file. HEAD no longer contains them, but the blob remains in the public repo's
  history. The host is decommissioned and no password was involved, so this is
  housekeeping rather than an exposure — worth folding into the history purge if
  §1.3 is ever actioned.

---

## 6. Resolved — kept for reference

Fixed and verified; listed so they are not re-reported.

- `/api/v1` had no authentication and took identity from a client-supplied
  `user_id`. Now bearer-authenticated with session-derived identity, default-deny.
- `/api/upload` was open to the internet; KYC documents were retrievable by
  filename alone.
- Admin roles existed but were never enforced.
- Stored XSS in the admin Markdown preview (quote in a URL broke out of the
  attribute).
- OTP had no request throttle; the master-code bypass worked in production.
- SMS gateway was called over plain HTTP with the API key in the query string.
- No transactions anywhere; order creation could half-fail.
- No pagination; validation errors returned 500; unknown writes returned a fake
  201 Created.
- `audit_logs` existed since migration 001 and nothing ever wrote to it.
- `media/assets` and `notifications/campaigns` were CRUD endpoints over tables
  nothing read or wrote.
- **Three high dependency advisories** (`next`, `postcss`, `sharp`) needed a
  breaking major. Upgraded to Next 16.3.1 with `eslint-config-next` 16,
  TypeScript 5.9 and `@types/react` 19.2: `npm audit` is now clean, and the 46
  engine, 20 questionnaire-guard and 15 Clear Records tests all pass on it. The
  EC2 box had already been running Next 16 locally since June without the change
  ever reaching the repository, so repo, Vercel and EC2 had drifted apart; they
  are now identical.
- **The custom domain was not a stale Vercel deployment.**
  `shathisheba.digigramventures.com` resolves to `18.143.126.210`, an EC2 box
  running the admin under pm2 behind nginx — a separate deployment that had never
  been diagnosed as such. Its 404s were simply June code. Redeployed from
  `origin/main`.
- `ADM-RDY-02`: the readiness instrument could be unbalanced by a single mistyped
  weight, with no error — the engine normalises by the in-scope weight, so a set
  summing to 0.94 still produced a score, a grade and a status, just the wrong
  ones, silently, for every assessment taken afterwards. Writes to
  `loan/questionnaire` now run inside a transaction and are rolled back unless
  each active set totals exactly 1.0000 and no branch points at a missing
  question (`lib/finance/questionnaire-guard.ts`). `GET
  admin/loan/questionnaire/integrity` shows the current totals and the core/deep
  split. Verified 20/20, including that a balance-preserving edit still passes.
- The API viewer listed ~70 rows flat and did not list the finance routes at all;
  it is now eleven filterable sections and the catalog documents all 97 routes.
- The main dashboard had no loan-pipeline card (`ADM-LON-04`).
