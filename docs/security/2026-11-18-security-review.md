# Security review — 2026-11-18

Authorized by the owner as a full review of ZEVQORA, inside and out. Active
testing ran locally only (PGlite with the real migrations, the real router and
handlers). Production (`zevqora.vercel.app`, Supabase `dhqag…`) got passive,
read-only checks: no accounts were created, nothing was written, nothing was
brute-forced. No `.env*` file was read. Findings from the 2026-11-13 pentest
(SEC-01..03, `2026-11-13-pentest-triage.md`) are not repeated here, except
where the status of SEC-03 matters.

## Executive summary

ZEVQORA's foundations are sound. Every API route checks who you are and which
workspace you belong to on the server. People outside a workspace get "not
found", so they can't tell which workspaces exist. The database lets browsers
read only their own data and write nothing. No secrets are in the public
website code. The security headers are strict.

The most important problem was money, not data. Production has the platform AI
key configured, and a free account could send requests to expensive AI models
that ZEVQORA had no price for. Those requests skipped the credit check. Sending
many requests at the same moment could also spend far beyond the $5 free
credit, and ZEVQORA pays that bill. This is fixed. Only models with a price on
record are allowed, and the cost of each request is set aside before it is
sent. A request without a reported cost is now charged at the list price
instead of $0.

Two medium issues are also fixed:
- **Look-alike invites.** Invite matching treated `_` and `%` as wildcards, so
  `j_hn@…` could pick up an invite meant for `john@…`.
- **Desktop could run any file.** One desktop bridge could launch any file,
  including programs on a network share, if the website were ever
  compromised. It now opens folders only.

Six smaller issues are fixed too. Six low/info items stay open, either for an
owner decision or as later hardening; they are listed at the end with the
actions only the owner can take.

| Severity | Found | Fixed in this branch | Open (owner decision / access) |
|---|---|---|---|
| Critical | 0 | — | — |
| High | 1 | 1 (SEC-04) | — |
| Medium | 2 | 2 (SEC-05, SEC-06) | — |
| Low | 8 | 5 (SEC-07, -08, -09, -11, -12¹) | 3 (SEC-13, -14, -15) |
| Info | 4 | 1 (SEC-10) | 3 (SEC-16, -17, -18) |
| **Total** | **15** | **9** | **6** |

¹ Runtime dependencies fixed; dev-only tooling advisories and the Python audit remain.

## Scope and method

- **Code review of every route** in `api/_lib/handlers/*`, plus `auth.js`,
  `router.js`, `http.js`, `platform-compute.js`, `platform-guard.js`,
  `openrouter.js`, `pricing.js`, `plan-limits.js`, `env-isolation.js`,
  `stripe.js` and `support/limits.js`. For each route it checked:
  - sign-in and workspace role (owner/admin/member/viewer) checks,
  - access to other workspaces' data by guessing IDs (IDOR),
  - input validation and injection,
  - server-side requests (SSRF) and rate limits,
  - plan and credit enforcement,
  - Stripe signature checks, CORS and error leaks.
- **Supabase database:** all 22 migrations. That covers grants,
  every row-level security (RLS) policy, and the execute grants on
  SECURITY DEFINER functions (also covered by
  `supabase/tests/security_definer_check.sql`).
- **Sign-in flows:** password and username login, signup, the desktop
  hand-off (`/desktop-auth`, create/exchange/refresh), invites (by token and
  automatic on sign-in), and the cron secret.
- **Browser app:** raw-HTML sinks such as `dangerouslySetInnerHTML` (only
  static legal text), links built from user content (CMS `safeHref`), and Zev
  answer rendering.
- **Desktop:** Electron `main.cjs` and `preload.cjs`
  (context isolation, sandbox, sender-origin check, navigation and window-open
  handlers, deep links, every IPC handler), and the FastAPI local API
  (127.0.0.1 binding, per-launch token, TrustedHost, CORS).
- **Dependencies:** `npm audit` for the web app and the desktop app. The Python
  dependency audit was not run (`pip-audit` is not installed here); see SEC-12.
- **Production, passive only** (through a real browser, because Vercel's bot
  challenge answers plain `curl` with 429):
  - response headers,
  - whether `/.env`, `/.git/*`, `/package.json`, `/vercel.json` and source
    files are exposed,
  - unauthenticated calls to the protected API routes,
  - CORS,
  - a scan of the public JS bundle (80 files) for key patterns,
  - whether source maps are published.

### Production passive results

| Check | Result |
|---|---|
| Security headers on pages and API | HSTS (2 years, preload), CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`: all present |
| `/.env`, `/.env.local`, `/.git/config`, `/.git/HEAD`, `/package.json`, `/vercel.json`, `/src/*`, `/supabase/*` | Not exposed. The SPA fallback returns `index.html` |
| Source maps | None referenced; `*.js.map` returns 403 |
| Public bundle | No OpenRouter, OpenAI, Anthropic, Stripe secret, webhook, `sb_secret_`, service-role JWT or server env names. Only the publishable Supabase key, which is meant to be public |
| `/api/me`, `/api/admin/*`, `/api/desktop/session`, `/api/platform/status`, `/api/engine/health`, `/api/zevir/graphs` without a token | 401 `AUTH_REQUIRED` |
| `/api/cron/daily` without the secret | 401 |
| CORS | API sends no `Access-Control-Allow-Origin`, except telemetry ingest (`*`, by design: bearer token, no cookies) |
| Bot protection | Vercel challenge active for non-browser clients |
| `/api/health` | `cloudReplayConfigured: true`: the platform AI key is set in production, so SEC-04 was live |

## Findings

### SEC-04 — Platform AI spend was not bounded (High) — Fixed

- **Affected:** `api/_lib/platform-compute.js` (`completeForUser`), reached from:
  - `POST /api/platform/chat/completions` (desktop proxy),
  - `POST /api/engine/agent/chat` (`model` in body),
  - `POST /api/engine/products/:id/implementations/prepare` (`model` in body).
- **Problems:**
  1. Any model id matching `MODEL_RE` was forwarded to OpenRouter. For models
     missing from `model_pricing` (for example `openai/o1-pro`, or
     `openrouter/auto`, which can route to any model), the estimate was `null`
     and the "could exceed remaining credit" check was skipped. Only
     `remaining > 0` was required.
  2. When the provider response carried no `usage.cost`, the call was charged
     `$0`.
  3. The balance check and the charge are separate steps. Concurrent calls all
     passed the same check. The limiter is per serverless instance, so
     parallel instances multiply it.
- **Reproduce (local, PGlite/mocks):** `tests/sec-2026-11-18.test.ts` → SEC-04.
  On the code from `main`:
  - an unpriced model is forwarded,
  - `openrouter/auto` is forwarded as-is,
  - a missing provider cost is charged as `0`,
  - 4 concurrent calls against $0.10 of credit all reach the provider.
- **Impact:** A free account with a confirmed email could make the platform pay
  for expensive models far beyond its $5 credit:
  - One 400k-character request to a frontier model can cost tens of dollars.
  - About 20 of them in parallel (the per-minute limit, per instance) cost
    hundreds of dollars before the overdraft blocks the account.
  - Repeated with throwaway accounts, this drains the OpenRouter balance.
  - No customer data is exposed.
- **Fix:**
  - **Priced models only.** Only models with an exact `model_pricing` row
    (active, not embedding) are forwarded. Two ids the desktop engine has always
    sent (`deepseek/deepseek-chat`, `mistralai/mistral-small`) are budgeted at
    their priced rows. Anything else returns 400 `MODEL_NOT_ALLOWED`.
  - **No `openrouter/auto`.** It runs on `openai/gpt-4o-mini`, matching what
    web Zev already did.
  - **Cost held in flight.** The worst-case estimate is reserved in the durable
    counter `usage_budget_reserve` (migration 022, bucket
    `credit:hold:<billing user>`, limit = remaining credit) for the length of
    the call, then released. A refused hold returns 402. A counter that cannot
    answer returns 503 and no call is made.
  - **No free calls.** A response without a provider cost is charged at the
    list-price estimate of its reported tokens
    (`cost_source = pricing_snapshot_estimate`).
- **Regression tests:** `tests/sec-2026-11-18.test.ts` (7 cases).
- **Status:** Fixed in this branch. **Owner follow-up:** set a monthly spending
  limit on the OpenRouter key, and run the read-only query under "Owner
  actions" to check for past use.

### SEC-05 — Email lookups treated `_` and `%` as wildcards (Medium) — Fixed

- **Affected:**
  - `api/_lib/handlers/me.js` `acceptPendingInvites` (runs on every
    `GET /api/me`),
  - `api/_lib/handlers/workspaces.js` `POST /api/workspaces/:id/invites`
    (adds an existing account),
  - `api/_lib/handlers/admin.js` `POST /api/admin/admins`.
- **Problem:** `.ilike('email', value)` puts the value into a Postgres `ILIKE`
  pattern, where `_` matches any character and `%` matches anything.
  - The account `j_hn@outlook.com`, which a mail provider that allows
    underscores will register, matched a pending invite for
    `john@outlook.com`. That account then joined the workspace with the
    invite's role, possibly admin.
  - An invite to `x%@corp.com` added whichever single account matched.
  - The same wildcard matching affected the superadmin "grant admin" lookup.
  - Auto-accept also did not require a confirmed email.
- **Reproduce:** `tests/sec-2026-11-18.test.ts` → SEC-05. The ILIKE semantics
  are checked against real Postgres (PGlite).
- **Impact:**
  - Someone who can guess a pending invitee's address and register a
    look-alike gets into that workspace.
  - A workspace admin can probe who is registered with wildcard patterns.
- **Fix:**
  - New helper `likeLiteral()` (`api/_lib/http.js`) escapes `\ % _`, used at all
    three call sites.
  - Auto-accept also requires `email_confirmed_at` and re-checks
    case-insensitive equality before joining.
- **Status:** Fixed.

### SEC-06 — Desktop `open-path` bridge could run any file (Medium) — Fixed

- **Affected:** `desktop-app/desktop/electron/main.cjs`, IPC handler
  `zevqora:open-path`.
- **Problem:** The handler called `shell.openPath(path.resolve(target))` for
  any existing path. On a file, `openPath` launches it with its default
  handler, so `.exe`, `.bat` and `.lnk` files run. UNC paths
  (`\\host\share\x.exe`) and device paths were also accepted. The only
  callers open project and worktree folders.
- **Precondition:** script running on the shell's origin, i.e. XSS on
  `zevqora.vercel.app` (none found) or a compromised dependency.
- **Impact:** That script would become code execution on every desktop user's
  machine.
- **Fix:** `electron/bridge-guards.cjs` `resolveOpenablePath()`. It accepts an
  existing local directory only, and refuses UNC and device paths before
  touching the disk.
- **Regression test:** `tests/sec-2026-11-18.test.ts` → bridge guards.
- **Status:** Fixed in code. It reaches users only with the next desktop
  installer (owner action).

### SEC-07 — CSV export allowed spreadsheet formulas (Low) — Fixed

- **Affected:** `GET /api/experiments/:id/report.csv`.
- **Problem:** Model names and error text come from customer telemetry, which
  any holder of a connection token can write. A value like
  `=HYPERLINK(...)` or `+cmd|…` ran as a formula when the export was opened in
  a spreadsheet.
- **Fix:** `csvCell()` prefixes cells starting with `= + - @`, tab or CR with
  `'`. Numbers are left unchanged.
- **Status:** Fixed.

### SEC-08 — A malformed path escape crashed the router (Low) — Fixed

- **Affected:** `api/_lib/router.js`.
- **Problem:** `decodeURIComponent` on a route parameter such as
  `/api/projects/%E0%A4%A` threw outside the router's `try`. The function
  crashed with an unhandled error (platform 500) instead of a JSON 400, and
  the security-event log never saw it.
- **Fix:** Matching now runs inside the `try`, and malformed escapes return 400
  `BAD_PATH`.
- **Status:** Fixed.

### SEC-09 — Desktop platform bridge accepted `..` segments (Low) — Fixed

- **Affected:** `desktop-app/desktop/electron/main.cjs` `platformRequest`.
- **Problem:** The route allowlist regex allowed segments made of dots.
  `fetch(new URL('/api/me/../desktop/create-handoff', base))` resolves outside
  the allowlist, with the user's access token attached by main.
- **Fix:** `isAllowedPlatformPath()` in `bridge-guards.cjs` refuses `.` and `..`
  segments.
- **Status:** Fixed. Ships with the next installer.

### SEC-10 — Cron secret compared with `!==` (Info) — Fixed

- **Affected:** `GET /api/cron/daily`.
- **Fix:** Constant-time comparison (`safeEqual`). Wrong, missing and
  prefix-only secrets still return 401.
- **Status:** Fixed.

### SEC-11 — Password login was limited per instance only (Low) — Fixed

- **Affected:** `POST /api/auth/password-login`, used by the web login page for
  every sign-in.
- **Problem:** The server signs in to Supabase from Vercel's own addresses, so
  Supabase Auth's per-IP limits cannot tell callers apart. The only limit was
  an in-memory counter (12/min) per warm instance.
- **Fix:** Durable counters shared by every instance (`public_rate_limit_hit`,
  migration 021):
  - 30 attempts per visitor per 10 minutes,
  - 20 attempts per identifier per 15 minutes.

  Keys are keyed hashes, never the address or the email. If the counter is
  down, sign-in is not blocked and the in-memory limit still applies.
- **Residual risk:** someone can deliberately lock one identifier out of
  password sign-in for 15 minutes. Password reset still works. CAPTCHA (SEC-03
  option 1) would remove most of this.
- **Status:** Fixed.

### SEC-12 — Vulnerable dependencies (Low) — Fixed for runtime, partly open

- **Web runtime:** `fast-uri` (via `ajv`) and `qs` (via `stripe`), both
  moderate. `npm audit --omit=dev` now reports 0.
- **Desktop:** Electron 43.4.1 had several high advisories (preload cache
  poisoning, permission-origin confusion, `openExternal` origin attribution).
  The lockfile now pins 43.8.11, inside the existing `^43.2.0` range.
- **Open:**
  - Dev and build tooling only: `vitest`/`tinypool`, `picomatch`,
    `tailwindcss@3` and `vite@6` in desktop, `electron-builder`. These need
    major upgrades and are not shipped to users.
  - The Python backend (`fastapi`, `uvicorn`, `httpx`, `sqlalchemy`) was not
    audited here. Add `pip-audit` to the backend CI job.
- **Status:** Runtime dependencies fixed. Dev tooling and Python open (Info).

### SEC-13 — `/desktop-auth` creates a handoff without a click (Low) — Open, owner decision

- **Affected:** `src/auth/DesktopAuthPage.tsx`.
- **Problem:** A signed-in visitor who opens
  `/desktop-auth?state=<anything valid>` gets a handoff carrying their access
  and refresh tokens, created automatically, and is sent to the
  `zevqora://` deep link.
- **Why it is not exploitable today:** The code stays on the victim's machine
  and expires in 90 s. The desktop app also checks `state` against the one it
  generated, so an attacker gains nothing without a second leak.
- **Recommendation:** Require one "Connect ZEVQORA Desktop as <email>" click
  unless the page is returning from a sign-in it started (`resume=1`). This
  adds a click to the desktop sign-in flow, so it is left to the owner.

### SEC-14 — Inviting an existing account adds it immediately (Low) — Open, owner decision

- **Affected:** `POST /api/workspaces/:id/invites`.
- **Problem:** A registered address is added straight to the workspace, without
  consent, and the reply says so (`added: true`). An unregistered address gets
  an invite link instead. Any workspace admin can therefore tell whether an
  email is registered. This is the same kind of oracle as SEC-03.
- **Recommendation:** Always create an invite. The invitee is still added
  automatically on their next sign-in through the now-exact auto-accept, so the
  user experience barely changes. This changes `TeamPage`'s response handling.

### SEC-15 — Other limits are per instance only (Low) — Open

- **Per-instance limits:**
  - `POST /api/auth/username-available` (60/min; it reveals whether a username
    exists by design),
  - desktop `exchange-handoff` and `refresh`,
  - `analytics/collect`,
  - workspace and connection creation.
- **Telemetry volume:** ingest is bounded per connection (120 requests/min ×
  500 events), but not by plan.
- **Recommendation:** Move the public, unauthenticated ones to
  `public_rate_limit_hit`, and add a plan-based daily event cap for telemetry.

### SEC-16 — Viewers can read raw telemetry samples through Supabase directly (Info) — Open

- **Affected:** RLS policy `telemetry_select_member` (004), table
  `telemetry_events.sample`.
- **Problem:** The API never returns `sample`. The RLS policy, however, lets
  any workspace member, viewers included, select the column with the anon key
  plus their session. Sample capture is opt-in, and changing it is
  creator/admin only. Reading samples is not restricted the same way.
- **Recommendation:** If samples should be admin-only, revoke column `sample`
  from `authenticated` in a new, additive migration (with a rollback) and
  confirm the client never reads it.

### SEC-17 — Engineering Zev's platform-wide daily budget can be used up by free accounts (Info) — Open

- **Affected:** `ENGINEERING_ZEV_DAILY_USD_PLATFORM` (default $50/day), shared by
  every account.
- **Problem:** The per-scope budget is $5/day, and each user and each workspace
  is a separate scope. A few free accounts can therefore use up the shared
  budget and pause Engineering Zev for everyone until the next UTC day. There
  is no overspend.
- **Recommendation:** Give free plans a smaller per-scope cap, or none, and
  watch for `BUDGET_EXHAUSTED` in security events.

### SEC-18 — The desktop shell trusts its web origin (Info) — Accepted design

- **Design:** The packaged app renders `https://zevqora.vercel.app/app`. The
  bridge accepts calls from that origin, and from `file://` for the offline
  page.
- **Consequence:** An XSS on the website would reach the bridge (local API
  token, folder and trace pickers, platform requests). No XSS was found:
  - React escapes all output,
  - the only `dangerouslySetInnerHTML` is static legal text,
  - CMS links pass `safeHref`,
  - CSP is `script-src 'self'`.

  After SEC-06 and SEC-09 the bridge has no file-execution or route-escape
  primitive.
- **Recommendation:** Keep CSP strict, and consider dropping
  `style-src 'unsafe-inline'` when practical.

## Checked and found sound

- **Sign-in and roles:**
  - Every handler calls `requireUser`, except the public, webhook and cron
    routes.
  - Workspace access goes through `requireWorkspaceRole`, which returns 404 for
    non-members.
  - Project, connection, opportunity, experiment, product, plan, search, run
    and graph IDs are always loaded first, then checked against the caller's
    membership in the owning workspace.
- **Admin:** every admin route goes through `adminContext`. Admin grant and
  revoke require superadmin. Admins cannot suspend admins.
- **Role escalation:** Granting or revoking admin is owner-only. The owner role
  cannot be changed or removed. Members cannot change sample capture or revoke
  others' connections.
- **Stripe:**
  - `constructEventAsync` checks the signature, timestamp tolerance included.
  - The plan is derived from the price id, never from client input.
  - Checkout `metadata` is set by the server.
- **Desktop handoff:**
  - 32-byte codes, stored only as SHA-256.
  - The state hash is checked and the code can be used once (atomic
    `used_at`).
  - Sessions are encrypted with AES-256-GCM.
  - The desktop checks `state` against the one it generated.
- **Database:**
  - The browser roles have SELECT only, and only on intended tables.
  - All writes go through the server.
  - SECURITY DEFINER helpers are not executable by `anon`.
  - The identity-bound helpers ignore a foreign `uid`.
  - Credit and rollup RPCs are `service_role` only.
- **Secrets:**
  - The service-role key and OpenRouter, Stripe, Anthropic, handoff and cron
    secrets are referenced only server-side.
  - Preview builds refuse production database refs (`env-isolation.js`, build
    and runtime).
  - `vercel.json` `ignoreCommand` is intact.
- **SSRF:** The server fetches only fixed provider URLs (OpenRouter base URL
  from env, Supabase, Stripe). No user-supplied URL is fetched.
- **Local desktop API:** bound to 127.0.0.1, per-launch token compared with
  `secrets.compare_digest`, TrustedHost against DNS rebinding, CORS allowlist,
  `allow_credentials=False`.
- **Electron:** `contextIsolation`, `sandbox` and no `nodeIntegration`. Window
  opens are denied and navigation is pinned to the shell origin.
  `openExternal` allows https only, to the app host and code hosts.

## Owner actions (need access or a decision)

1. **Merge GO.** Merging this branch deploys production. Fixes SEC-04 to -12
   take effect for the web on merge.
2. **Desktop release.** SEC-06, SEC-09 and the Electron update reach users only
   with a new installer (`windows-release` workflow).
3. **OpenRouter dashboard.** Set a monthly credit limit on the platform key, as
   defence in depth for SEC-04.
4. **Check for past use of SEC-04.** Read-only, in the Supabase SQL editor for
   `dhqag…` (and `czhuf…` if it ever had the key):
   ```sql
   select metadata->>'requested_model' as model, metadata->>'cost_source' as cost_source,
          count(*) as calls, sum(credits_usd) as charged_usd
   from public.usage_events
   where created_at > now() - interval '90 days'
     and (metadata->>'cost_source' = 'unavailable'
          or metadata->>'requested_model' not in (select model from public.model_pricing where active and tier <> 'embedding'))
   group by 1, 2 order by calls desc;
   ```
   Compare the result with OpenRouter's own activity log for the same period.
5. **SEC-03 (still open), Supabase dashboard.** Enable CAPTCHA (Turnstile or
   hCaptcha) for Auth, which also strengthens SEC-11. Or choose server-managed
   signup (option 2 in the 2026-11-13 triage).
6. **Decisions:**
   - SEC-13: one-click confirmation on `/desktop-auth`.
   - SEC-14: always invite instead of adding.
   - SEC-16: samples admin-only.
   - SEC-17: free-plan Zev budget.

## Re-test

- 2026-11-18, local, branch `security/pentest-2026-11-18`.
- `tests/sec-2026-11-18.test.ts`: 18/18 pass with the fixes.
- The 16 cases that can run against `main`'s code: 13 fail there. The 3 that
  pass check behaviour the fixes had to keep: the invited address still joins,
  the cron route still refuses, sign-in works when the counter is down.
- Full suite, typecheck, lint, build, `verify:release` and build-isolation
  results are in the PR.
