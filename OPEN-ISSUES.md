# Shathi Sheba — Open Issues Register

Everything found, flagged or deliberately deferred across both repositories that
is **not yet resolved**. Anything already fixed is in git history and in
`SECURITY.md`, not here.

Last updated: 2026-08-17.

Severity: 🔴 blocks pilot · 🟠 fix before scale · 🟡 quality/maintenance · 🔵 nice to have

---

## 1. Needs a human — cannot be fixed in code

### 1.1 🔴 Deployed backend cannot reach the database

Every database-backed route returns **500 in production** while working locally.

| Route | `shathisheba-admin.vercel.app` | localhost |
|---|---|---|
| `/api/v1/catalog` (static array, no DB) | 200 | 200 |
| `/api/v1/geo/divisions` | **500** | 200 |
| `/api/v1/sale/categories` | **500** | 200 |
| `/api/v1/faq` | **500** | 200 |

`catalog` passes only because it is a hard-coded array, which is probably why the
deployment has looked healthy. **The mobile app has never received live data from
the deployed backend.**

**Most likely root cause — confirmed by inspection.** `README.md` documented the
wrong environment variables, and Vercel was almost certainly configured from it:

| README told you to set | What `lib/db.ts` actually reads |
|---|---|
| `DATABASE_URL` | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | neither — admin auth is a custom `admin_session` cookie |

`DATABASE_URL` appears nowhere in `lib/`, `app/` or `scripts/`. A deployment
configured from the old README therefore has **no database credentials at all**:
`mysql.createPool({ host: undefined, … })` fails on every query, which is exactly
the observed pattern — static routes 200, every database route 500.

The README has been corrected (commit following this note). Two secondary
candidates remain if fixing the variables is not sufficient:

1. The `MYSQL_HOST` in Vercel is the retired host. `.env.local` carries a
   commented-out "previous host" line — if Vercel still holds that value it no
   longer resolves. Compare it against the live `MYSQL_HOST` in `.env.local`.
2. The RDS security group does not permit Vercel's egress addresses.

**Action:**
1. In Vercel → Settings → Environment Variables, add the five `MYSQL_*` values
   from `.env.local`. Remove `DATABASE_URL` / `NEXTAUTH_*` if present — they do
   nothing.
2. Redeploy, then verify against a route that reads the database:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     https://shathisheba-admin.vercel.app/api/v1/geo/divisions
   ```
   200 = connected. **Do not use `/api/v1/catalog` to check** — it returns a
   hard-coded array and passes even with no database.
3. If it still returns 500, open the RDS security group to Vercel.

### 1.2 🔴 Custom domain serves a different deployment

`shathisheba.digigramventures.com` returns **404** for `/api/v1/app/finance/loan-products`
while `shathisheba-admin.vercel.app` returns 401 (route present, session required).
The custom domain is pointing at an older project or deployment.

**Action:** repoint the domain in Vercel. Until then, the app must not use it —
it would silently talk to stale code.

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

### 1.5 🟠 Three high dependency advisories need Next.js 16

`next`, `postcss` and `sharp` in the admin are only resolvable by a breaking major
upgrade. Left as a deliberate decision rather than forced.

**Action:** `npm audit fix --force` pulls next@16 — schedule and test properly.

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

| Phase | Scope | Severity |
|---|---|---|
| P3 | The 17-section evidence workspace: extended KYC, address, documents, enterprise profile, productive assets, financial profile, existing debt, transaction evidence, field verification (11 items × 5 verdicts), offline tablet drafts | 🔴 for Feature 2 |
| P4 | The 100-point scorecard engine: 8 criteria, configurable rating rules, hard stops, data confidence, pathway engine, reason codes, champion/challenger shadow mode, farmer result screen | 🔴 for Feature 2 |
| P5 | mPowerU behind `lib/mpoweru/adapter.ts` with a stub driver, session orchestration, webhook + polling, band→rating normalisation, mobile assessment screen | 🟠 |
| P6 | Development plans, reassessment, review-request queue, lender packs (PDF/CSV with Bangla fonts), lender submissions, disbursement, repayment tracking, home ticker, repayment notifications, admin collections with aging buckets | 🟠 |

Mobile screens specified but not yet added: `mpowerUAssessment`, `loanResult`,
`developmentPlan`, `assessmentHistory`, `loanAccount`, `loanConsentManage`,
`loanReviewRequest`.

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
  Set it to `true` before running the E2E suites.
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
