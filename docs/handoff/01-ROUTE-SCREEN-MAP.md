# Route → Screen → Capability → Data Source
Base: release `8e591cd` routes from `src/App.tsx`, `src/app/AppRoutes.tsx` and `src/app/AppShell.tsx`. New entries below are a patch proposal until applied.

| Route | UI source | Auth | Source / truthful availability |
|---|---|---|---|
| `/` | Marketing `HomePage`, changed hero; NEW `SupportZevLauncher` | Public | CMS `useSiteContent`; public FAQ local-only; canonical `HeroMark3D` |
| `/product` | Existing ProductPage | Public | Published content and explanatory preview, not authenticated tenant |
| `/technology` / `/how-it-works` | Existing TechnologyPage; NEW redirect alias | Public | ZevIR/method docs and honest roadmap |
| `/evaluation` / `/proof` | Existing EvaluationPage; NEW redirect alias | Public | Internal evidence, confidence qualifiers |
| `/pricing` | Existing PricingPage/Grid; NEW fallback cards | Public | Supabase `plans` live where available; reference $49/$99/from $299 on error only |
| `/security` | Existing SecurityPage | Public | Source-backed existing controls; no certification promise |
| `/company`, `/team` | Existing Company/Team pages | Public | TeamPage release already names Nero, Khuslen, Bat-Ochir |
| `/privacy`, `/terms` | Existing LegalPage | Public | Legal source; legal review still needed |
| `/download` | Existing DownloadPage | Public | Download only when installer verified |
| `/demo/*` | NEW redirect to `/product` | Public | Public showroom retired; internal synthetic engine fixtures NOT removed |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/callback` | Existing Supabase auth | Public/session | Existing auth; no replacement |
| `/app/onboarding` | Existing OnboardingPage | Auth | Workspace and evidence workflow; verify actual staging |
| `/app` | Existing `CommandCenterView` | Auth+workspace | `/api/workspaces/:id/command-center`; CEO/CTO/Developer are presentation modes ONLY |
| `/app/workloads` | Existing WorkloadsView | Auth+workspace | Engine workload source, permission-bound |
| `/app/graph` | Existing `GraphExplorer` | Auth+flag+workspace | `/api/zevir/*`; lazy flow, bounded pages, null coverage |
| `/app/diagnoses` | Existing DiagnosesView | Auth+workspace | Evidence-backed diagnosis APIs |
| `/app/optimize` | Existing OptimizeView / PlanSearchSection | Auth+flag+workspace | Frozen contracts, bounded search, replay; no auto-deploy |
| `/app/experiments` | Existing ExperimentsView | Auth+workspace | Runs and evidence |
| `/app/evidence` | Existing EvidenceView | Auth+workspace | Source-linked reports; no fake realized savings |
| `/app/changes` | Existing ChangesView | Auth+workspace | Human review, not automatic merge |
| `/app/value` | Existing ValueView | Auth+workspace | Observed/evaluated/projected/realized separated |
| `/app/connections` | Existing ConnectionsView + NEW IntegrationCatalog | Auth+workspace | Existing repo/import flow; reference catalogue has no connection state claims |
| `/app/zev` | Existing ZevView | Auth+workspace | `/api/engine/agent/chat`; NEVER called by public support |
| `/app/team`, `/app/settings`, `/app/usage`, `/app/docs` | Existing AppShell pages | Auth+workspace | Existing membership/billing/docs; server authorization remains mandatory |
| `/app/enterprise` | NEW EnterpriseView | Auth+workspace | Role-aware request and capabilities overview; NO SSO/SCIM backend mutation |
| `/admin/*` | Existing AdminRoutes | Platform admin only | `/api/admin/*` and `admin_roles`; no CEO display-mode privilege |

## Page-state requirements after applying
Every fetch-backed view: loading/empty/disabled/permission-denied/retryable-error/partial-evidence states. Workspace switch must cancel or discard stale reads. Public FAQ has no private session access, no page-load network requests and no synthetic chat outcome. New catalogue is a setup guide; provider verification cannot be inferred from static cards.
