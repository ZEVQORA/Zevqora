# Source-Status and Claim Provenance
No fabricated customer traction, realized savings, billing readiness, compliance, model-provider connections or automatic deployment.

| Claim / UI | Source | Label and mandatory qualifier | Forbidden interpretation |
|---|---|---|---|
| "Measure. Replay. Verify. Then optimize." | Repository README / marketing brand line | Product method; not autonomous deployment | Universal safe optimizer already in production |
| Internal candidate 42.01% cheaper | Release README and benchmark evidence | **INTERNAL / REJECTED** (quality 0.87 under frozen 0.95 floor) | 42.01% customer savings |
| Candidate D estimated 12.32% lower cost | Release README and evaluation | **INTERNAL / VERIFIED sample estimate; CI crosses zero** | Guaranteed improvement or realized production dollars |
| DUREM evidence | Release README | Affiliated design-partner workload evaluation | Independent third-party validation |
| ZevIR execution graph | Release migration/handler/UI | **EXISTING_IN_BRANCH**, staging/deployed capability UNVERIFIED | Arbitrary SaaS source automatically connected |
| Optimization and Pareto | `src/product/optimize.ts`, optimize handlers | Existing source under flags and contract; no deploy | Self-deploying agent or production guard |
| One dataset, three presentations | `src/app/AppShell.tsx`, command center | CEO/CTO/Developer display selection only | Platform admin or tenant data elevation |
| Pricing Starter $49, Pro $99, Enterprise from $299 | User-approved redesign reference; `src/lib/referencePlans.ts` on design branch | **REFERENCE ONLY** when live `plans` unavailable, with mailto request | Active Stripe checkout or approved commercial offer |
| Three co-founders | Release TeamPage, supplied requirements | Nero (CEO), Khuslen (CTO), Bat-Ochir (CMO) | Unverified social accounts, equity stakes |
| Public Zev FAQ | New `SupportZevLauncher` | **PUBLIC FAQ — NOT LIVE AGENT** | Chat knows signed-in customer, human online, personalized help |
| Integration gallery | `SETUP_CATALOG`, adapter/repo code | **SETUP REQUIRED** or **NOT AVAILABLE** | Credentials authorized, data healthy, direct vendor OAuth |
| Enterprise SSO / SCIM / private deployment | New EnterpriseView and brief | **REQUEST SETUP / PROPOSED / NOT CONNECTED** | Verified SOC2, HIPAA, EU residency or active SAML |
| Human change review | Source app/optimization | Evaluator VERIFIED then human review; deployment separate | Verified means deployed or realized |

## Claim UI normalizers
- `EvidenceClaim`: OBSERVED, EVALUATED, PROJECTED, REALIZED, SYNTHETIC, INTERNAL, UNKNOWN.
- Missing numeric `null` → `Unknown`, known zero → `$0.00` when unit USD. Never coerce via `value || 0`.
- Verdict `VERIFIED`, `REJECTED`, `INCOMPLETE`; never `DEPLOYED` or equivalent inferred from badge.
- If a feature flag or migration is unavailable, show unavailable and the actual reason. Do not fall back to successful fixture in production.

## Required later audit
Compare literal marketing copy and plan records in the actual checked-out integrated branch, inspect public sitemap/SEO JSON-LD, screenshots, published CMS and payment config. Verify public social/contact links. The audit has not executed on staging or production in this session.
