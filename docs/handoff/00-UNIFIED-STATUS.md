# ZEVQORA — Unified vNext + ZevIR Frontend: Status

Updated 2026-10-31 after the integration was actually applied and built.
**Release verdict: HOLD.** Nothing here is pushed, merged, deployed or migrated.

## Source identity (verified with `git` at execution time)

| Item | Value |
|---|---|
| Base | `release/vnext-part3-production` = `8e591cd214b79deea2a1c19fcdd4a126d0184249` (remote ref re-checked with `git ls-remote` on 2026-10-31; unchanged) |
| Design source | `design/zevqora-frontend-refresh` = `207cab5f977395a23b3be9765b099da7bedea412`. Branched from `main` (`97079d5`), so 39 commits behind the release and 1 ahead; it deletes most of `api/_lib/optimize`, `api/_lib/zevir`, the Part 3 handlers and their tests. **Never merged wholesale.** |
| Redesign ZIP | `zevqora-frontend-redesign (1).zip` was attached this time. Its tree is byte-identical to `207cab5` apart from CRLF line endings, so the branch was used as the design source. |
| Integration branch | `integration/unified-vnext-zevir-ui` (local only), in its own worktree `D:/BeBe_personal/ZEVQORA-unified`. |
| Commits on top of `8e591cd` | `d9298ae` patch as delivered · `1d70614` integration repairs and gateway · docs commit (this file) |

## What is IMPLEMENTED (in code, covered by tests, not deployed)

| Area | Implementation | Truthfulness rule enforced |
|---|---|---|
| Public hero | `HomePage` hero: dark immersive section, canonical `HeroMark3D` (locked `MARK_PATH`), display size `clamp(2.5rem,5.8vw,5.75rem)` (≈14% under the patch's 6.7rem), Space Grotesk display face, AA-contrast CTAs | Mark is decorative (`aria-hidden`); copy still comes from CMS `site_content` / `DEFAULT_CONTENT` |
| Public nav | Product · How it works · Evidence · Pricing · Security · Team; `/how-it-works`→`/technology`, `/proof`→`/evaluation`, `/demo/*`→`/product` | `POST /api/optimize/demo` (internal, admin-only) untouched |
| Public Zev support | `SupportZevLauncher` on `/` only: FAQ-only dialog, focus trap, Esc closes and focus returns to the sticker | No network request, no `/api/engine/agent/chat`, labelled "Public FAQ · Not a live agent" |
| Pricing fallback | `PricingReferenceFallback` renders $49 / $99 / from $299 **only** when live plans fail to load | Labelled reference/unconfirmed; mailto CTAs, never checkout |
| Team | Unchanged release page: Bayarbayasgalan Enkhtulga (Nero), Khuslen Ganbat, Bat-Ochir | No invented bios or social profiles |
| Connections catalogue | `IntegrationCatalog` under the existing evidence cards on `/app/connections` | Static capability cards; the only live state is **EVIDENCE RECEIVED**, from server-returned ZevIR graphs. Never CONNECTED / HEALTHY |
| Evidence-source gateway | `src/lib/clients/evidence-sources.ts` over existing `GET /api/zevir/graphs` | Unknown timestamps stay `null`; cross-workspace rows dropped; capped counts flagged; server error code surfaced with retry |
| Role contract | `src/lib/contracts/roles.ts`: minimum role per existing endpoint | Test reads handler source and fails on drift; presentation mode is not a role |
| Enterprise | `/app/enterprise`: server-verified role, role-capability table, optimization flag from `/api/me`, PROPOSED/REQUEST statuses | No SSO/SCIM/region/certification claims; owner/admin get a mailto, not a ticket |
| Auth polish | Show/hide password on signup and reset; one column on phones; all inputs 16px below `sm` | No auth logic changed |

## NOT_CONNECTED (UI exists, backend does not)

- Integration control plane (list/test/rotate/revoke workspace connections): `disconnectedGateway` rejects with `INTEGRATION_NOT_CONNECTED`.
- Enterprise capability API and enterprise request API (`ENTERPRISE_REQUEST_API_AVAILABLE = false`).
- Public generative support / ticket API (`PUBLIC_SUPPORT_MODE = 'public_faq'`).
- Runtime telemetry (`POST /api/telemetry/ingest`) exists but does not feed the proof engine, and this release's Connections screen does not issue its tokens → catalogue says NOT CONNECTED.

## BLOCKED / NOT RUN

| Item | Status | Why |
|---|---|---|
| Push / PR | NOT DONE | Needs founder approval; the repository is public |
| Staging migrations 013, 016–019, A/B RLS, E2E proof loop | NOT RUN | No authorized isolated staging environment in this session (see `docs/staging-runbook.md`) |
| Signed-in screens in a real browser | NOT RUN | Local dev has no API backend or Supabase env; product screens verified in jsdom tests only |
| Lighthouse / LCP / CLS / INP | NOT RUN | No deployed preview |
| 200% zoom and reduced-motion screenshots | NOT RUN in browser | Covered only by code paths (`useReducedMotion`, no continuous animation) |

## Preserved

No change to `api/`, `supabase/` (migrations, rollback, tests), `schemas/`, `package.json` / lockfile, auth/session logic, admin, `src/product/graph`, `src/product/command`, `src/product/optimize.ts`. One defensive guard was added to `src/brand/HeroMark3D.tsx` (`matchMedia` may be absent); the mark geometry is unchanged and `verify:release` still checks it.

See `08-TEST-RESULTS.md` for command-by-command results, `02-API-CONTRACT-MAP.md` for existing vs proposed endpoints and `09-BACKEND-TODO.md` for the remaining backend work, deploy and rollback.
