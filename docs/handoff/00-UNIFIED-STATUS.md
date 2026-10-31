# ZEVQORA — Unified Frontend Status
Date: 2026-10-31 (Asia/Ulaanbaatar)
Review target: 2026-11-08 GO/HOLD. Recommended current release state: **HOLD**.

## Source identity and what was inspected
- Base release branch: `ZEVQORA/Zevqora` `release/vnext-part3-production` at `8e591cd214b79deea2a1c19fcdd4a126d0184249` (read via GitHub connector, **NOT** checked out locally).
- Redesign source: `design/zevqora-frontend-refresh` at `207cab5f977395a23b3be9765b099da7bedea412` (GitHub read-only). Compare confirmed `diverged`, 39 commits behind release, 1 ahead.
- CEO-approved brief: `ZEVQORA_KHUSLEN_UNIFIED_VNEXT_ZEVIR_FRONTEND_HANDOFF_2026-10-31(1).md`, supplied in the conversation.
- `zevqora-frontend-redesign.zip`: referenced in the brief but **not attached in this conversation**. Design branch was used for comparison; identical ZIP bytes have not been inspected in this execution.
- GitHub integration write attempt: creating `feat/unified-vnext-zevir-ui-20261031` returned **403 Resource not accessible by integration**. No remote branch, commit or PR created.
- Local environment cannot clone GitHub (`Could not resolve host: github.com`). Hence integration against the full repo, npm ci, typecheck, lint, tests, build, browser E2E and staging are **NOT RUN**.

## Actual deliverable — local source patch, NOT merged code
This ZIP contains a guarded `tools/apply_unified_patch.py`, original new React/TS components, tests and ten handoff docs. The patch script validates the exact base commit, refuses protected branches and dirty worktrees, verifies source anchors before writing, then patches only source/view files and `docs/handoff/`. It never executes git push/merge/deploy, SQL migrations, Stripe, OpenRouter or third-party API calls.

### New frontend components/code
- `src/marketing/SupportZevLauncher.tsx`: accessible public Zev FAQ modal, verified contact route, zero private API calls, no fake generative/human messaging.
- `src/marketing/PricingReferenceFallback.tsx`: reference prices $49/$99/from $299 shown ONLY when server plan loading errors, with a warning and mailto CTAs instead of fake checkout.
- `src/product/views/IntegrationCatalog.tsx`: filterable source setup catalogue, explicit SETUP REQUIRED / NOT AVAILABLE status; no faux "connected" providers.
- `src/product/views/EnterpriseView.tsx`: capability-request surface, real workspace role display, role-gated email request, no fictitious SSO/compliance toggles.
- `src/lib/contracts/{claims,connections,support,enterprise}.ts`: independent, typed frontend contract and provenance semantics.
- `src/lib/clients/integrations.ts`: conservative catalog, disconnected backend gateway that rejects rather than silently returning fixture success.
- `tests/unified-frontend.test.ts`: checks for known-zero vs unknown, verdict whitelist, disallowed fake connections, public support and enterprise offline paths.

### Existing source files patched by script
`src/App.tsx`, `src/app/AppRoutes.tsx`, `src/app/AppShell.tsx`, `src/marketing/MarketingLayout.tsx`, `src/marketing/HomePage.tsx`, `src/marketing/Pricing.tsx`, `src/product/views/ConnectionsView.tsx`.

### Preserved by design
NO changes to `api/`, `supabase/`, `schemas/zevir/`, `src/product/graph/`, `src/product/command/`, `src/product/optimize.ts`, auth/session/role code, admin routes, internal synthetic `/api/optimize/demo`, database or staging/production.

## Explicit limitations
- This patch is NOT yet a complete frontend merge and NOT an accepted release candidate. Existing release routes and functionality are retained conceptually but cannot be certified until the patch is applied and checks pass.
- Design-branch `EngineSections`, selected font/CSS/auth redesign and QA screenshots are not fully ported. The hero uses release assets and coherent black/blue visual treatment as an integration-safe alternative.
- Existing full graph/optimization/Command Center UI was reviewed but not modified; its functionality depends on flags/migrations and live backend verification.
- Connector control plane and separate public support API are PROPOSED only. Enterprise request uses mailto, not a ticket backend.
- The present patch cannot establish current production payment, migration or source evidence status.

## Safe use
See `README-APPLY.md`. Apply only on a new local feature branch from the exact release commit; then run `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run verify:release`, and repair any failures **before** a draft PR. Founder authorization required for production merge, migration, deployment and marketing publication.
