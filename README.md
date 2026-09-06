# ZEVQORA

AI cost optimization engineer for AI products. **Cut AI COGS without cutting product quality.**

Measure. Replay. Verify. Then optimize.

```
connect evidence → map spend → diagnose waste → generate candidate
→ replay workload → evaluate quality → verify savings → human review
```

## Repository layout

| Path | What it is |
| --- | --- |
| `src/` | Web application (Vite + React + TypeScript + Tailwind v4): public website, auth, logged-in app, internal admin |
| `api/` | One Vercel serverless function (`api/[...path].js`) routing every API endpoint; libraries and handlers in `api/_lib/` |
| `supabase/migrations/` | Postgres schema, RLS policies, seed data and SQL functions (applied in order) |
| `tests/` | Vitest unit tests for the API engines (router, tokens, sanitization, pricing, graders, gates, analysis) |
| `desktop-app/` | ZEVQORA Desktop (Electron) and the local FastAPI engine for repository scanning and offline replay |
| `docs/evidence/` | Immutable benchmark evidence packs (verified in CI) |
| `public/` | Static assets: self-hosted Satoshi, Zev sprites, favicon |

## Architecture

- **Auth**: Supabase Auth (Google, GitHub, email/password with username-or-email sign-in), PKCE in the browser.
- **Data**: Supabase Postgres. Every workspace table carries row-level security; authenticated users hold `SELECT` only.
  All writes go through the API, which re-checks the caller's workspace role and plan limits.
- **API**: Web-standard `Request`/`Response` handlers on Vercel. Auth, validation, rate limits and audit logging live in `api/_lib`.
- **Telemetry**: `POST /api/telemetry/ingest` with a scoped connection token (`zqt_…`, hashed at rest, shown once, revocable).
- **Analysis**: deterministic, no model calls (`api/_lib/engine/analysis.js`).
- **Replay**: bounded candidate execution on the ZEVQORA platform OpenRouter credential (server-side only), deterministic graders, named gates.
- **Credits**: server-side, transactional, idempotent (`consume_credits` SQL function). Users cannot touch their balance.
- **Pricing/plans/content/flags**: database tables managed from `/admin`; the public site and the app read the same rows.
- **Admin**: `admin_roles` table checked on every admin API; every mutation lands in `admin_audit_log`.

## Local development

```bash
npm install
npm run dev          # web app on http://127.0.0.1:5173 (API calls proxy to :3000)
npx vercel dev       # optional: serverless API on :3000 with pulled env vars
```

Checks:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Deployment

The root of this repository is the Vercel project `zevqora` (framework: Vite, output `dist/`, functions in `api/`).
See `SETUP.md` for environment variables, Supabase configuration and the release checklist.

## Claim safety

- The internal benchmark found a candidate **42.01% cheaper** and **rejected it** (quality 0.87 against a frozen 0.95 floor). This is not a production savings claim.
- Candidate D was **verified** at 12.32% on the same benchmark; its 95% confidence interval crosses zero, so it is a point estimate.
- The DUREM evaluation is an **affiliated design-partner** real-workload evaluation, never "independent third-party validation".
- No customers, ARR, MRR or design partners are claimed anywhere without data behind them.
