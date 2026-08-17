# Finance — Readiness and Loan

Reference for the two finance features built against `SRS-FIN-01 v1.2`. Feature 1
is **Readiness**, a self-declared check that produces a score, a grade and a
short list of things to fix. Feature 2 is **Loan intake and pricing** — products,
quotes, repayment schedules and applications.

Everything described here is built and running. Phases P3–P6 of the SRS (the
evidence workspace, the 100-point scorecard, the mPowerU adapter, development
plans, lender packs, disbursement and collections) are **not** built; they are
tracked in [`../OPEN-ISSUES.md`](../OPEN-ISSUES.md) §3.

Last updated: 2026-08-17.

---

## 1. Where things live

| Concern | File |
|---|---|
| Readiness scoring | `lib/finance/readiness-engine.ts` |
| Loan pricing and schedules | `lib/finance/pricing-engine.ts` |
| The 100-point scorecard | `lib/finance/scorecard-engine.ts` |
| Instrument invariants | `lib/finance/questionnaire-guard.ts`, `lib/finance/scorecard-guard.ts` |
| Farmer-facing endpoints | `lib/endpoints/finance.ts` |
| Console aggregates | `lib/endpoints/admin-loan.ts` |
| Assessment orchestration | `lib/endpoints/credit-assessment.ts` |
| Schema — readiness | `database/migrations/021_finance_readiness.sql` |
| Schema — loan | `database/migrations/022_loan_core.sql` |
| Schema — evidence | `database/migrations/023_loan_evidence.sql` |
| Schema — scorecard | `database/migrations/024_credit_scorecard.sql` |
| Engine tests | `scripts/test-finance-engines.mjs` (46), `scripts/test-scorecard-engine.mjs` (95) |
| Demo data | `scripts/seed-finance-demo.cjs` (`--remove` reverses it) |
| Mobile screens and helpers | `Shathi Sheba/App.tsx`, `Shathi Sheba/src/finance/helpers.ts` |

Both engines are pure functions with no database access. That is deliberate: they
are the part that must be testable without a connection, and the part where a
quiet arithmetic mistake is most expensive.

---

## 2. Feature 1 — Readiness

### 2.1 The instrument

Twenty yes/no questions in one versioned set. Part 1 (`core`, questions 1–10) is
the short check; Part 2 (`deep`, questions 11–20) is optional and unlocks the
higher confidence tier.

| | Weight |
|---|---|
| Part 1 `core` | 0.5900 |
| Part 2 `deep` | 0.4100 |
| **Total** | **1.0000** |

| Category | Weight |
|---|---|
| `kyc` | 0.1200 |
| `enterprise` | 0.3600 |
| `financial` | 0.5200 |

Two questions carry flags, and three branch:

| Question | Behaviour |
|---|---|
| Q1 (`gate`, `NO_NID`) | Answering *No* forces status `currently_ineligible` regardless of score |
| Q12 (`risk`, `ARREARS`) | Answering *Yes* forces status `development_required` |
| Q11, Q12, Q13 | Presented only when Q9 was answered *Yes*; otherwise suppressed |

### 2.2 Scoring

`scoreReadiness()` normalises to whatever was actually put in front of the
farmer, so a Part 1 result and a full result are on the same 0–100 scale:

```
in_scope_weight = Σ weight(q) for every presented question
branch_weight   = Σ weight(q) for every branch-suppressed question
earned          = Σ weight(q) where the answer was Yes

score = round( ((earned + 0.5 × branch_weight) / (in_scope_weight + branch_weight)) × 100 , 2)
```

Suppressed branches earn **half** credit rather than zero or full. A farmer with
no existing loan is not penalised for the three questions about servicing one,
and is not rewarded either.

`gradeFor()` — bands are inclusive at the lower bound:

| Score | Grade | Label (en) |
|---|---|---|
| ≥ 80 | A | Excellent |
| ≥ 70 | B | Good |
| ≥ 60 | C | Marginal |
| < 60 | D | Needs development |

The stored grade for a low score stays `D`; only the label softens. `D` renders
in a muted brick (`#B4443C`), never an alarm red — the screen has to be readable
as a starting point rather than a rejection.

### 2.3 Confidence

`deriveConfidence()` never returns `high`. `high` is reserved for field-verified
loan assessments, which is a P3 concern. `medium` requires all three of:

- the full 20-question check (`depth = 'full'`), and
- at least 3 corroboration signals, and
- signal **S1**, a verified National ID.

Anything else is `low`. The seven signals are queried from platform behaviour the
farmer did not self-declare:

| Code | Signal |
|---|---|
| S1 | National ID verified |
| S2 | Banking or MFS details saved |
| S3 | Farm information recorded |
| S4 | Completed a transaction on the platform |
| S5 | Enrolled in a partner project |
| S6 | Completed a training item |
| S7 | Personal information complete |

### 2.4 Status

`deriveStatus()` is evaluated top-down, first match wins:

1. gate triggered → `currently_ineligible`
2. risk triggered → `development_required`
3. score ≥ 80 **and** confidence `medium` **and** depth `full` → `bank_ready_indicative`
4. score ≥ 80 → `conditionally_ready`
5. score ≥ 70 → `conditionally_ready`
6. score ≥ 60 **and** enterprise ≥ 70% → `project_ready`
7. score ≥ 60 → `development_required`
8. otherwise → `development_required`

Rules 4 and 5 collapse to the same status on purpose — they are kept apart
because the SRS distinguishes them and P4 will.

### 2.5 What the app is not told

`GET app/finance/readiness/questions` omits `weight`, `category`, `flag` and
`flag_code`. `shapeReadinessResult()` ranks gaps and recommended actions by weight
descending but never returns the weight itself. A client that cannot see the model
cannot be gamed against it.

Action links are route tokens (`screen:kycUpload`, `sheet:banking`), not URLs. The
app resolves them through `resolveActionLink()`; an unrecognised token renders as
plain text rather than a dead button.

### 2.6 Instrument integrity (ADM-RDY-02)

Question rows are editable through the generic CRUD engine, so the invariant is
enforced on write. Every write to `loan/questionnaire` runs inside a transaction
and is rolled back unless, for each **active** set:

- the weights of all active questions total exactly `1.0000`, and
- no active branch points at a question that is missing or inactive.

Weights are compared as integer ten-thousandths, not floats. A rejection is a
400 naming the actual total and the offending branches; the edit never lands.

This matters because the failure is otherwise silent. The engine normalises by the
in-scope weight, so a set summing to 0.94 still produces a score, a grade and a
status — the wrong ones, for every assessment taken afterwards, with no error
anywhere.

Check the current state before editing:

```bash
curl -s -b "admin_session=<token>" \
  http://localhost:3000/api/v1/admin/loan/questionnaire/integrity
```

```json
{ "ok": true, "required_total": 1,
  "sets": [{ "version": "v1", "active_questions": 20, "total_weight": 1,
             "core_weight": 0.59, "deep_weight": 0.41,
             "balanced": true, "problems": [] }] }
```

To re-balance, move weight between questions in **one** transaction. Two separate
requests will not work — the first is rejected because it leaves the set
unbalanced, which is the guard behaving correctly.

---

## 3. Feature 2 — Loan intake and pricing

### 3.1 Products

Nine rows, three active. The remaining six are seeded as `coming_soon` so the app
can show the full shelf without offering what does not exist yet.

| Code | Name | Rate | Tenures (months) | Amount |
|---|---|---|---|---|
| `livestock` | Livestock loan | 7.00% flat | 4, 6, 12 | ৳10,000 – ৳200,000 |
| `general` | General loan | 13.00% flat | 6, 12, 24 | ৳10,000 – ৳300,000 |
| `cooperative` | Cooperative loan | 15.00% flat | 6, 12, 24 | ৳5,000 – ৳200,000 |

All three accept `weekly`, `monthly` and `one_time` repayment. Amounts are the
SRS placeholders and are configuration, not code — change them in `loan_products`.

### 3.2 Pricing

Flat-rate interest on the full principal for the whole tenure. **Every
intermediate value is an integer number of paisa**; taka appear only in the
returned object. Across 96 weekly instalments, float arithmetic drifts enough to
make the schedule fail to reconcile.

```
interest      = round(principal × rate × months / (100 × 12))
fee           = round(principal × fee_pct / 100) + fee_flat
total_payable = principal + interest + fee
n             = one_time → 1 · weekly → months × weeks_per_month · monthly → months
emi           = round(total_payable / n)
final_emi     = total_payable − emi × (n − 1)
```

The rounding residue is carried entirely onto the **final** instalment and never
distributed across the others. `generateSchedule()` asserts that the instalments
sum to `total_payable` and throws if they do not — a schedule that does not
reconcile must not reach a farmer.

Worked example from the SRS, reproduced exactly by the engine: ৳100,000 at 15%
over 24 months, weekly. 96 instalments of ৳1,354.17 with a final instalment of
৳1,353.85, summing to ৳130,000.00.

`effectiveAnnualRate()` — `rate × 2 × n/(n+1)` — is computed and stored on the
quote but **stripped from the farmer-facing payload**. A flat rate understates
true cost against reducing balance, and next to the headline rate the two would
be read as the same number. Admins and lender packs see it.

`addMonthsClamped()` clamps overflow rather than rolling forward: 31 January plus
one month is 28 February, not 3 March.

### 3.3 Application submission

`POST app/finance/applications` is one transaction that writes the application
row, six consent rows and the first timeline event together:

```
profile_creation · kyc_verification · field_verification
financial_assessment · mpoweru_assessment · share_with_lender
```

A half-created credit application — one with terms but no recorded consent — is
worse than no application, because nothing downstream can tell it apart from a
complete one.

---

## 3A. The 100-point scorecard (P4)

Eight weighted criteria, 60 quantitative + 40 qualitative, totalling exactly 100.

| Criterion | Weight | Layer | Metric it reads |
|---|---:|---|---|
| Cash flow and repayment capacity | 25 | quant | `dscr` — (income − expenses) ÷ proposed instalment |
| Existing debt and repayment history | 15 | quant | `debt_burden_ratio` — existing instalments ÷ income |
| Enterprise economics | 10 | quant | `enterprise_years` |
| Transaction and market evidence | 10 | quant | `platform_transactions` — **queried, never self-reported** |
| mPowerU behavioural intelligence | 20 | qual | `mpoweru_score` |
| Management and trainability | 8 | qual | `training_completed` — queried |
| Cooperative and field validation | 7 | qual | `verification_ratio` — of the 11 items |
| Documentation and compliance | 5 | qual | `document_ratio` |

Each criterion is rated 0–5 by configurable bands in `scorecard_rating_rules`
(min inclusive, max exclusive, first match wins), then
`weighted_score = weight × rating ÷ 5`. Each criterion is rounded once and the
total is the sum of those rounded parts, so the column on screen adds up to the
headline number.

Grades: A ≥ 80 · B ≥ 70 · C ≥ 60 · D < 60, configurable per model version.

### What the engine refuses to do

- **Missing data rates 0 and is flagged** (`had_data = false`), never skipped and
  never averaged away. Averaging away an absent criterion rewards the incomplete
  application over the complete one that answered honestly and scored badly.
  A recorded zero is different: no debt with known income rates 5, but debt that
  was never asked about rates 0 with the gap visible.
- **Hard stops are evaluated before and independently of the score.** A
  hard-stopped application still gets a full score, because "declined, and would
  have been a B" is a different conversation from "declined, and was a D".
  A hard stop overrides every readiness rule (ENG-21 R6) and cannot be cleared by
  adding safeguards.
- **An unrecognised `check_key` throws.** A configured hard stop the engine cannot
  evaluate must not silently pass — that would approve on the strength of a
  control that never ran.
- **Safeguards never move the inherent grade.** They produce a second, parallel
  result. A guarantee makes a loan safer to write; it does not make the borrower
  stronger. Only a rule written *for* safeguards counts as a structured result —
  otherwise the engine reports none rather than restating the inherent one.
- **Overrides require a rating of 0–5 and a reason**, and the computed rating is
  kept alongside. An unexplained override is indistinguishable from a mistake
  when someone reviews the file a year later.

### Immutability

`POST admin/loan/assess` never updates. It marks the previous assessment
`superseded` and inserts the next `sequence_no`, in one transaction, storing a
verbatim snapshot of every input, the model thresholds, the criteria and the
rules it used. Re-running that snapshot through that model version reproduces the
score exactly, after the evidence has been edited and the model re-tuned.

Scoring is restricted to `super_admin`, `hq_admin`, `credit_analyst` and
`credit_approver`. A `field_officer` — who captures the evidence — cannot score
it (ENG-24, separation of duties).

### Instrument integrity

`GET admin/loan/scorecard/integrity` reports each model's weight total, its
60/40 split and its threshold ordering. Writes to `loan/scorecard-models` and
`loan/scorecard-criteria` are rolled back unless an active or shadow model totals
exactly 100.00 with descending thresholds — the same guard, and the same reason,
as `ADM-RDY-02`.

---

## 3B. Disbursement, repayment and collections (P6)

`POST admin/loan/disburse` is the only place money leaves, and it is the narrowest
permission in the finance surface: `credit_approver` and above — never the analyst
who scored the file, never the officer who collected the evidence.

Four invariants:

- **Terms are snapshotted onto `loan_accounts`.** A live loan reads its rate,
  tenure and instalment from its own row, never from `loan_products`. Repricing a
  product must not silently reprice somebody's outstanding loan (`DAT-04`).
- **`SUM(schedule.amount_due) == total_payable`, exactly.** The pricing engine
  asserts it before the rows are written; if it throws, the disbursement fails
  rather than creating a loan whose instalments don't add up (`DAT-05`).
- **A payment is allocated oldest-due-first and never over-allocated.** ৳5,000
  against ৳3,000 of arrears and a ৳4,000 instalment clears the arrears and
  part-pays the instalment. More than the outstanding balance is refused rather
  than parked — an over-payment sitting in an account is a reconciliation problem
  later.
- **Aggregates are derived, not incremented.** `refreshAccount` recomputes from
  the schedule every time. A running total that drifts from the rows it
  summarises is worse than none, because every screen then shows a confident
  wrong number.

A part-paid instalment that is late reads `overdue`, not `partial` — reporting it
as merely partial hides the lateness from collections.

Dates leave these endpoints as plain `YYYY-MM-DD`. A MySQL `DATE` has no timezone
and mysql2 hands it back at local midnight; passing it through would give either
`"Sat Mar 14 2026 00:00:00 GMT+0600"` from `String()` or **the day before** from
JSON's UTC serialisation at +06:00. A due date shown a day early is a farmer told
the wrong deadline.

Collections is at `/loan/collections`: aging buckets, portfolio at risk, and
payment recording on the same page — the person chasing an arrear is the person
who takes the payment, and making them navigate away loses the row.

## 3C. mPowerU (P5) — adapter only, no live provider

**EcoDev have not supplied a sandbox.** `lib/mpoweru/adapter.ts` is written
against the contract the SRS describes, and the only driver that exists is a
stub. When the real endpoint arrives, one file is added
(`lib/mpoweru/drivers/…`), `MPOWERU_DRIVER` is changed, and nothing that calls
the adapter moves.

The seams that are already real:

| Concern | How |
|---|---|
| Pseudonymity (`ADM-LON-22`) | The provider gets a salted SHA-256 of the user id, never the id and never a document. `respondentIdFor` throws if `MPOWERU_RESPONDENT_SALT` is unset rather than emitting a guessable hash of a small integer |
| Idempotency (`ADM-LON-23`) | One live session per application; a repeat `start` returns the existing one. Field connectivity retries, and a second respondent means the farmer sits two assessments |
| Webhook + polling (`ADM-LON-23`) | Both call the same `syncMpowerUSession`, which is a no-op once complete. Webhooks are lost; polling alone is slow |
| Webhook authenticity | HMAC, constant-time compared. Even the stub verifies — a driver that returned `true` unconditionally would be inherited by whoever copies it as a starting point. An unauthenticated webhook that sets a behavioural score writes 20 points onto any application from the internet |
| Factor restriction (`ADM-LON-24`) | Only the normalised band reaches `loan_evidence`. Factor output is **omitted from the payload entirely** for a field officer, not nulled, so nothing hints the field exists. Neither the respondent id nor the factors appear in audit rows |
| Failure ≠ zero (`ADM-LON-25`) | A failed assessment writes no evidence. The criterion then reads as no-data, which the scorecard rates 0 **and flags** — a visible gap, not a silent penalty for the provider's outage |

The stub is deterministic (a random stub makes every test flaky and shows a
different grade on each demo refresh) and obviously fake: session ids start
`stub_`, `is_stub` is on every result, and `assertDriverUsableHere` refuses it
under `NODE_ENV=production` unless `MPOWERU_ALLOW_STUB_IN_PRODUCTION=true`.

Environment: `MPOWERU_DRIVER`, `MPOWERU_RESPONDENT_SALT`, `MPOWERU_WEBHOOK_SECRET`.

---

## 4. API surface

All finance routes are bearer-authenticated. `app/finance/*` is ownership-scoped
by the session's `user_id`; the client cannot pass someone else's. `admin/loan/*`
is staff-only via `ADMIN_ONLY` in `lib/api-access.ts`.

### Farmer

| Method | Path |
|---|---|
| GET | `app/finance/summary?user_id=` |
| GET | `app/finance/readiness/questions` |
| POST | `app/finance/readiness/submit` |
| GET | `app/finance/readiness/latest?user_id=` |
| GET | `app/finance/readiness/history?user_id=` |
| GET | `app/finance/readiness/signals?user_id=` |
| GET | `app/finance/loan-products` |
| GET | `app/finance/purposes` |
| POST | `app/finance/quote` |
| POST | `app/finance/quote/schedule` |
| GET | `app/finance/applications?user_id=` |
| GET | `app/finance/applications/{code}` |
| POST | `app/finance/applications` |
| POST | `app/finance/applications/{code}/withdraw` |
| GET | `app/finance/consents?user_id=` |
| GET | `app/finance/assessment?user_id=` |
| GET | `app/finance/assessment/history?user_id=` |
| GET | `app/finance/development-plan?user_id=` |
| POST | `app/finance/reassessment-request` |

A `part: 'deep'` submission merges the stored Part 1 answers, so the farmer
answers ten questions and is scored against twenty.

`app/finance/summary` drives the home Finance Passport card. State precedence:
`loan_graded` › `loan_in_progress` › `readiness` › `readiness_partial` ›
`not_assessed`, plus a `next_payment` ticker when an account is live.

`getLoanPurposes` exists separately from the admin `loan/purposes` resource
because the latter is `ADMIN_ONLY` — a farmer hitting it would get a 403 on the
loan intake screen.

### Console

| Method | Path |
|---|---|
| GET | `admin/loan/dashboard` |
| GET | `admin/loan/queue?status=&limit=&offset=` |
| GET | `admin/loan/questionnaire/integrity` |
| POST | `admin/loan/assess` |
| GET | `admin/loan/assessment?application_id=` |
| GET | `admin/loan/scorecard/integrity` |
| GET | `admin/loan/workspace?application_id=` |
| POST | `admin/loan/evidence` |
| POST | `admin/loan/verification` |
| POST | `admin/loan/development-plan` |

### The workspace (P3)

`/loan/applications/{id}` is where an officer works an application. The queue
links here rather than to the generic row viewer.

Only the sections the scorecard reads are editable: financial profile, enterprise
experience, the behavioural score, and the eleven-item field verification. The
rest of §18.3 is captured through the existing KYC and profile surfaces.

Three things the workspace does that a plain form would not:

- **The requirement checklist is computed server-side**, not remembered. A
  checklist someone has to hold in their head is a checklist that gets skipped on
  the busy day. `ready_to_score` is false until every blocking item is done, and
  the screen names what is missing.
- **Saving the financial profile also records `debt_section_complete`.** Zero
  recorded debts is otherwise indistinguishable from "never asked", and the
  difference is a rating of 5 versus 0 on a fifteen-point criterion.
- **A `contradictory` verdict raises mandatory manual review** (`ADM-LON-19`) from
  inside the save, not from the caller. Resolving it clears the flag, because the
  rule is recomputed rather than latched.

Writes are open to `field_officer` and above — capture is their job — while
scoring stays with the credit roles. Every save is audited with the previous
value, because "who changed the income figure after the field visit" is the first
question anyone asks when an assessment looks wrong.

Every figure on the credit dashboard is queried. `ADM-LON-34` forbids seeded
numbers on credit surfaces, and rightly — a plausible fake figure on a credit
screen is worse than an empty state, because nobody can tell it is fake.

---

## 5. Schema

Migration `021_finance_readiness.sql`:
`readiness_question_sets`, `readiness_questions`, `readiness_assessments`,
`readiness_answers`, `readiness_confidence_signals`.

Migration `022_loan_core.sql`:
`loan_products`, `loan_applications`, `loan_application_events`,
`loan_consent_types`, `loan_consents`, `loan_quotes`, `loan_accounts`,
`loan_repayment_schedule`, `loan_repayments`, `loan_purposes`.

`022` also adds the `credit_analyst` and `credit_approver` admin roles and
`admin_users.assigned_districts_json`.

Both migrations are idempotent: structure is guarded by `information_schema`
probes, seeds are `INSERT IGNORE` against unique keys. Re-running either is safe.
**Never edit a released migration** — add a new one.

---

## 6. Mobile screens

Twelve screens in `App.tsx`, plus the Finance Passport card on Home and a menu
row in Profile:

```
financeReadinessIntro → financeReadinessQuiz → financeReadinessResult
financeGuidanceSheet
financeHub
loanApplyType → loanApplyDetails → loanApplySchedulePreview
              → loanApplyProfile → loanApplyConsent → loanApplyDone
loanStatus
loanResult → developmentPlan
           → assessmentHistory
```

Once an assessment exists, the home Finance Passport card opens `loanResult`
rather than `loanStatus` — the grade printed on the card is what the tap is
asking about.

`loanResult` follows the prescribed section order (MOB-LON-24): outcome, then
what to do about it, then strengths, then gaps. A screen that opens with the
weaknesses reads as a verdict; this one reads as a next step. A blocked result
leads with what would change it and never uses the word "rejected"
(MOB-LON-27).

The history screen carries a `kind` on each narrative item — `resolved`,
`gained`, `appeared`, `lost` — because a reason code's label describes the
finding, not the change. Printing "Low behavioural assessment result" under
*What improved* tells the farmer the opposite of what happened, so the screen
builds the sentence from how the item moved.

Grade colours live in `src/finance/helpers.ts` (`GRADE_COLORS`) so the result
screen, the passport card and the status screen cannot drift apart.

Screens specified but not built: `mpowerUAssessment` (P5), `loanAccount` (P6),
`loanConsentManage`, `loanReviewRequest`.

---

## 7. Testing

```bash
node scripts/test-finance-engines.mjs        # 46 cases — readiness + pricing
node scripts/test-scorecard-engine.mjs       # 95 cases — the 100-point scorecard
node scripts/seed-finance-demo.cjs           # 7 readiness checks + 6 applications
node scripts/seed-finance-demo.cjs --remove  # reverses it
```

The engine suite checks both engines against the SRS's own worked fixtures and
reconciles 135 amount/tenure/mode combinations. It transpiles the TypeScript in
memory, so there is no build step.

Demo rows are tagged (`purpose_text LIKE '[demo seed]'`,
`question_set_version LIKE '%-demo'`) and `--remove` keys off those tags, so it
cannot take real data with it.

---

## 8. Deliberate omissions

Recorded so they are not re-reported as bugs:

- **Confidence never reaches `high`.** By design — see §2.3.
- **The farmer never sees weights, categories or flags.** See §2.5.
- **The farmer never sees the effective annual rate.** See §3.2.
- **Rules 4 and 5 of `deriveStatus` return the same value.** See §2.4.
- **Finance responses are not yet excluded from the app's AsyncStorage cache**
  (`SEC-14`), and NID is still stored in plaintext (`SEC-18`). Both were deferred
  by agreement while testing with your own data; both are required before real
  applicant data is captured. `OPEN-ISSUES.md` §2.
