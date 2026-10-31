# Verification Evidence and Result Log

Updated 2026-10-31. Executed on a Windows 11 laptop (Node v24.15.0, npm 11.12.1), in a separate git worktree, `OPENROUTER_API_KEY=""` and no `.env` in the worktree, so no real provider key was loaded. Every command below was actually run; anything not run says so.

## 1. Baseline — untouched release `8e591cd`

| Command | Exit | Result |
|---|---|---|
| `npm ci` | 0 | 345 packages |
| `npm run typecheck` | 0 | — |
| `npm run lint` | 0 | — |
| `npm run test` | 0 | 40 files, **476/476** tests |
| `npm run build` | 0 | built in 22.5 s |
| `npm run verify:release` | 0 | "ZEVQORA release preflight passed." |

## 2. Patch application

| Step | Result |
|---|---|
| `apply_unified_patch.py <worktree> --check` | **Refused** on Windows: the toplevel check compares git's `D:/…` with Python's `D:\…`. Run from a copy with only that comparison normalised (and `ROOT` pointed at the package); transformation code unchanged |
| `--check` (normalised copy) | PASS — HEAD = `8e591cd`, branch not protected, tree clean, 7 anchors matched exactly once, 27 files validated |
| `--apply` | PASS — 7 files edited, 10 overlay files, 10 handoff docs; `git diff --check` clean; no line-ending churn |
| typecheck + lint on raw patch | 0 / 0 → committed as delivered: `d9298ae` |

## 3. Integrated branch — `1d70614` (code-final)

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | — |
| `npm run lint` | 0 | — |
| `npm run test` (default workers) | 1 / 1 / 1 | Three runs: 42/42 files and 508/508 tests passed, but Vitest reported `[vitest-worker]: Timeout calling "onTaskUpdate"`; then 2 and 3 timeouts in **untouched** PGlite suites (`plan-search-compute`, `row-cap`, `optimize-acceptance`, `zevir-routes`, `optimize-view`) — a different set each time, with run time growing 157 s → 213 s → 289 s while the machine was at ~79% CPU and 2.4 of 7.9 GB RAM free |
| `npx vitest run tests/plan-search-compute.test.ts tests/row-cap.test.ts` | 0 | 5/5 in isolation |
| `npx vitest run --maxWorkers=2 --minWorkers=1` | **0** | **42/42 files, 508/508 tests** (158 s) |
| `npm run build` | 0 | built in 29.3 s; `HomePage` 34.1 kB, `ConnectionsView` 16.9 kB, `EnterpriseView` 11.4 kB, CSS 85.7 kB |
| `npm run verify:release` | 0 | "ZEVQORA release preflight passed." (mark geometry, no browser secrets, no retired claims) |
| `git diff --check 8e591cd HEAD` | 2 | Only `public/fonts/space-grotesk/OFL.txt` (trailing spaces inside the verbatim SIL licence text; kept verbatim on purpose) |
| `git diff --stat 8e591cd HEAD -- api supabase schemas package.json package-lock.json vercel.json` | — | empty |

Not touched by this branch: the files whose tests flaked under load. `api/` is byte-identical to `8e591cd`.

Regressions the full suite caught and that were fixed before the code-final commit:
- `tests/a11y.test.tsx` home page and `tests/website-admin-ui.test.tsx` homepage: `HeroMark3D` called `window.matchMedia` unguarded once the patch put it on the home page → guarded.
- `SupportZevLauncher`: focus did not return to the sticker after Esc/close (trigger unmounted while open) → fixed; now tested.

## 3b. Re-run on `fecd790` before the draft PR (2026-10-31)

| Command | Exit | Result |
|---|---|---|
| `git status --porcelain` | — | empty (clean tree) |
| `npx vitest run --maxWorkers=2 --minWorkers=1` | **0** | **42/42 files, 508/508 tests** (163 s) |
| `npm run typecheck` | 0 | — |
| `npm run lint` | 0 | — |
| `npm run build` | 0 | — |
| `npm run verify:release` | 0 | "ZEVQORA release preflight passed." |
| `node -e "await import('./api/index.js')"` (CI's API import step) | 0 | `api ok` |
| Secret scan of the diff vs `8e591cd` (key/JWT/webhook/private-key patterns) | — | no matches; only `.env.example` files are tracked |

## 4. New tests (`tests/unified-integration.test.tsx`, 27 tests; overlay `tests/unified-frontend.test.ts`, 5 tests)

- Role mirror: 12 endpoint minimum roles checked against handler source; role rank checked against `api/_lib/auth.js`; unknown role (`'ceo'`) denied.
- Gateway: null timestamps stay null; flag-off vs setup-required; newest server timestamp; cross-workspace rows dropped; cap → lower bound; server error codes (`NOT_FOUND`, `OFFLINE`) kept; no label can read CONNECTED / HEALTHY / ACTIVE.
- `IntegrationCatalog`: upgrades only the card whose `source_kind` the server returned; error + Retry; axe clean.
- `EnterpriseView`: viewer sees "Not with your role" for freeze, no request CTA, one `<main>`, zero `fetch`, axe clean.
- `SupportZevLauncher`: source has no `/api/`, `fetch(`, agent route or product store; zero `fetch`; dialog named; Esc closes and returns focus; axe clean.
- Routing/claims: `/demo/*` redirect present, `POST /api/optimize/demo` still registered, sitemap has no `/demo`; three founders present; reference pricing never reaches Stripe/checkout.

## 5. Local browser QA (Vite dev on `127.0.0.1:5181`, no API backend, no Supabase env)

| Check | Result |
|---|---|
| Horizontal page overflow at 360 / 390 / 768 / 1024 / 1440 on `/`, `/pricing`, `/team`, `/signup`, `/login`, `/demo/anything`, `/how-it-works`, `/proof` | None (wide elements are inside their own horizontal scrollers, e.g. the pricing comparison table) |
| Redirects | `/demo/anything` → `/product`, `/how-it-works` → `/technology`, `/proof` → `/evaluation` |
| Hero h1 | 40 px at 360/390, 74 px at 1280, 84 px at 1440; Space Grotesk |
| Form inputs | 16 px at 360/390; 15 px from 768 |
| Support panel (375×812) | 343×567 px inside the viewport; focus starts on Close; Tab/Shift+Tab wrap inside; Esc closes; focus returns to the sticker |
| Network while using the panel | Only pre-existing page calls (`/api/public-config`, cookieless pageview `/api/analytics/collect`); none from the panel, none to `/api/engine/agent/chat` |
| Screenshots | Desktop and 375px hero captured in the session; not committed |

## 6. NOT RUN

| Item | Reason |
|---|---|
| Staging migrations (013, 016–019), A/B RLS, `npm run test:staging` | No authorized isolated staging environment; needs founder approval |
| End-to-end proof loop (sign-in → ingest → graph → freeze → baseline → plan search → replay → verdict → review) and its negative cases | Same; product screens were tested in jsdom only |
| Signed-in screens in a browser | No API backend / Supabase env locally |
| 200% zoom, reduced-motion capture, contrast audit in a browser, Lighthouse | Not run; reduced motion relies on `useReducedMotion` in `HeroMark3D` (no continuous animation) |
| CI on GitHub | See the draft PR; `.github/workflows/ci.yml` runs on every push and pull request |

## Release status
**HOLD.** Code checks are green; staging, E2E and founder/CTO/CMO reviews are outstanding.
