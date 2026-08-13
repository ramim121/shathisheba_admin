# Security — Shathi Sheba platform

Covers both repositories: `shathisheba_admin` (Next.js console + `/api/v1` backend)
and `shathisheba-mobile-app` (Expo/React Native client).

Last reviewed: 2026-08-13.

---

## 1. Action required by a human

These cannot be fixed in code and are the only open items rated critical or high.

### 1.1 Rotate the WeatherAPI key — it is public 🔴

`.env` was committed to the **mobile** repository in commit `5950fd5` and that commit
is on `origin/main` of a public GitHub repo. A later commit removed the file and added
it to `.gitignore`, but **removing a file from HEAD does not remove it from history** —
the blob is still fetchable by anyone who clones the repo.

Leaked values, and whether they are still live:

| Key | Status |
|---|---|
| `EXPO_PUBLIC_WEATHERAPI_KEY` | **still in use — rotate now** |
| `GEMINI_API_KEY` / `EXPO_PUBLIC_GEMINI_API_KEY` | already rotated since the leak |
| `EXPO_PUBLIC_API_BASE_URL` | not a secret |

Steps, in order:

1. Rotate the key at weatherapi.com and put the new value in `.env` locally and in
   the build environment. Do this **first** — it is what actually ends the exposure.
2. Optionally purge the blob from history. This rewrites commits, so every clone
   must be re-cloned afterwards:
   ```bash
   git filter-repo --path .env --invert-paths     # pip install git-filter-repo
   git push --force --all
   git push --force --tags
   ```
   Treat this as damage limitation only. Assume anything ever pushed public is
   compromised permanently; rotation is the real fix.

### 1.2 Keys shipped inside the mobile binary 🔴

`EXPO_PUBLIC_*` values are compiled into the JavaScript bundle and are extractable
from any distributed APK — `EXPO_PUBLIC_GEMINI_API_KEY` and
`EXPO_PUBLIC_WEATHERAPI_KEY` are both in that category today. Rotating them does not
help, because the next build embeds the new value just the same.

The fix is architectural: proxy both providers through the backend so the phone
calls `/api/v1/...` with its session token and the keys never leave the server.
`src/ai/gemini.ts` was extracted from `App.tsx` partly to make that a single-file
change.

### 1.3 Backend base URL is plain HTTP 🟠

`EXPO_PUBLIC_API_BASE_URL` is `http://`. Every request — including the bearer
session token — travels in cleartext. Terminate TLS in front of the API and move
the app to `https://` before any public release.

### 1.4 Remaining dependency advisories 🟠

`npm audit` is clean of criticals in both projects. Three high advisories remain in
the admin (`next`, `postcss`, `sharp`) and are only resolvable by upgrading to
**Next.js 16**, a breaking major. That upgrade is a deliberate decision, not a
patch, so it was left for the maintainer.

```bash
npm audit            # review
npm audit fix        # safe, semver-compatible only
npm audit fix --force  # pulls next@16 — breaking, test thoroughly
```

---

## 2. What this codebase now enforces

### Authentication

- `/api/v1/*` requires a caller. `Authorization: Bearer <token>` is resolved against
  `app_sessions`; the admin console is recognised by its `admin_session` cookie.
- Resources are **default-deny**. A new entry in `db-resources.ts` is private until
  it is deliberately listed in `lib/api-access.ts`.
- Public without a token: reference/lookup data only (geography, catalogues,
  weather, FAQ, the onboarding tree) plus OTP request/verify, which cannot require
  a token by definition.

### Identity

- A user's `user_id` is taken from their session, never from the request. A
  client-supplied `?user_id=` is **overwritten** rather than validated, so there is
  no parameter left to tamper with. Admins may still act on any `user_id` because
  the console legitimately inspects other people's records.

### Authorisation

- The six `admin_users.role` values are enforced on writes (`lib/api-access.ts`,
  `adminMayWrite`). Reads stay open to any admin because the console's navigation
  assumes it. `auditor` is read-only; `content_editor` cannot approve enrolments;
  `marketplace_manager` cannot edit learning content; `super_admin` is unrestricted.
- Generic table writes by app users are limited to an allow-list. Destructive verbs
  on generic tables are admin-only.

### Rate limiting

- OTP requests: 60s minimum between codes per phone, 5/hour per phone, 20/hour per
  source address. Verification already capped at 5 attempts per code; without the
  request throttle an attacker could reset that counter indefinitely and spend the
  SMS balance doing it.

### Data handling

- Passwords: scrypt with a per-password random salt, compared with
  `timingSafeEqual`.
- KYC documents are private in S3 and served through `/api/files/kyc/[name]`, which
  now requires a caller and confirms ownership. Previously the filename alone was
  the only thing protecting an NID scan.
- Uploads require a caller. `/api/upload` was open to the internet.
- Multi-statement writes (order placement, order confirmation with stock deduction,
  sale payment confirmation) run in transactions with `SELECT ... FOR UPDATE` on the
  stock rows.
- Every approval decision and every admin login, successful or failed, is written to
  `audit_logs`.

### Input and output

- Write payloads are filtered against a per-resource column allow-list (no mass
  assignment) and rejected if a field is over 20,000 characters, the body has more
  than 100 fields, the body is not an object, or a number is not finite.
- Validation failures return **400** with a message written for the user. Genuine
  database faults return **500** with a generic message; the driver's text and SQL
  are logged server-side and never sent to the client.
- The admin Markdown preview escapes `& < > " '` and restricts link/image URLs to
  `http(s)`, `mailto:`, `/` and `#`. Escaping angle brackets alone was not enough:
  a quote in a URL closed the `href`/`src` attribute and the remainder became live
  markup.
- The SMS gateway is called over HTTPS. The API key and recipient number are in the
  query string, so the previous cleartext call exposed both to every intermediate
  hop.

---

## 3. Known gaps, accepted for now

| Gap | Effect | Why it is open |
|---|---|---|
| No offline write queue | Work composed offline is lost, not retried | Product scope |
| Composite-key resources resolve by partial key | `user/interests`-style resources address the wrong row via `?id=` | Needs a compound-key API |
| No automated test suite | Regressions are caught by manual E2E only | The harnesses in this pass are a starting point |
| Cached responses unencrypted on device | AsyncStorage holds personal data in plaintext | Needs encrypted storage |
| `App.tsx` is ~6,200 lines | Slow to change; merge conflicts | Theme/types/AI/API layers extracted; screens remain |
| No per-column schema validation | Only shape guards, not types per column | Schema layer not yet introduced |

---

## 4. Reporting

Report suspected vulnerabilities privately to the maintainer rather than opening a
public issue. Do not include live credentials in the report.
