# Design Fidelity — design branch visuals, release behaviour

Updated 2026-10-31. Rule applied: `design/zevqora-frontend-refresh` @ `207cab5` decides **how ZEVQORA looks**; `release/vnext-part3-production` @ `8e591cd` decides **how it works**.

## How the design was restored

- **Copied verbatim from `207cab5`:** the design-only files, which the release never touched:
  - Stylesheets: `engine.css`, `experience.css`, `refinements.css`, `kinetic-experience.css`, `type-edition.css`.
  - `EngineFilm`, `CinematicField`, `EngineCanvasFallback`, `RollingPrice`.
  - `Hero`, `EngineSections`, `TypeMethod`, `DecisionEvidence`, `ExperienceSections`, `Editorial`, `EngineEnd`, `ProductPreview`.
  - `HowItWorksPage`, `ProofPage`, `DownloadPage`, `NotFoundPage`.
  - `AuthShell`, `LoginPage`, `PasswordInput`, `Metric`, `Panel`, `referencePlans`, `config`, `main.tsx`.
  - `public/cinema/lighter-engine.webp` and `robots.txt`.
- **Taken from the design, then re-wired to release behaviour:** files both branches changed (`MarketingLayout`, `HomePage`, `Pricing`, `PricingPage`, `ProductPage`, `SecurityPage`, `TeamPage`, `LegalPage`, `SignupPage`, `site.ts`, `AppShell`, `AdminShell`). The design's markup is kept, and the release's data, claims, analytics, SEO and security copy are put back into it.
- **Not taken:**
  - `src/demo/*` and `src/design/DesignIndex.tsx`: the public demo and the "All screens" index are retired.
  - `vite.config.ts` `allowedHosts`: local tooling only.
- **New:**
  - `src/styles/unified.css`, for surfaces the design never had: status banner, footer disclosure, three-founder grid, evaluation form, 16px phone inputs.
  - `PageTitle` now calls the release's `useSeo`, which sets the description, canonical URL and social tags, and skips them inside admin previews.

## Section checklist (verified by side-by-side capture at 1440×900 and 375×812)

| Page | Design section | Status | Notes |
|---|---|---|---|
| All | Dark full-bleed header, nav (Product · The engine · Evidence · Pricing · Security), Sign in, "Start optimizing" | PRESERVED | Release `status.banner` shows above it only when set |
| All | Numbered mobile menu, "Let's get lighter" | PRESERVED | Demo and "All screens" items replaced by Our team and Evaluate your workload |
| All | Oversized footer: brand line, three link groups, giant ZEVQORA wordmark, bottom row | PRESERVED | Links changed: "Interactive demo" → Evaluate your workload, "Documentation (/demo/docs)" and "All screens" removed, "Company" added. Release claim and analytics disclosure added under the wordmark (+~90px) |
| All | Route transition (motion), Space Grotesk display type, colours, spacing | PRESERVED | Same stylesheets, byte for byte |
| `/` | Cinematic hero (EngineFilm canvas, "Make AI lighter.", pitch, CTAs, transport and pause) | PRESERVED | "Inside the product" goes to `/product` instead of `/demo` |
| `/` | Ticker, manifesto, four-chapter scroll (Observe, Challenge, Verify, Release) | PRESERVED | Chapter links go to `/product`, `/how-it-works`, `/proof`, `/security` instead of `/demo/*`. The ticker gained `role="img"` (axe: `aria-prohibited-attr`) |
| `/` | Product stage, "We rejected it." evidence, boundaries, "Big brain. Soft side." Zev, pricing, "Go build something lighter." | PRESERVED | Section heights identical to the design at both widths |
| `/` | Zev support sticker | ADDED | FAQ-only, no network. Appears after the visitor scrolls past most of the hero, so it never covers the hero CTA or the motion control |
| `/product` | Intro, product stage, feature rows, "Meet your code where it lives", Zev, end | PRESERVED | Feature rows now come from the CMS `product.features`: the six vNext capabilities instead of five pre-vNext rows. The "Runtime telemetry" card is replaced by "Trace and span evidence", because runtime telemetry is not connected in this release |
| `/how-it-works` | Whole page | PRESERVED | Primary CTA goes to `/evaluation` (was `/demo/opportunities`). `/technology` now redirects here |
| `/proof` | Whole page | PRESERVED | Identical heights |
| `/pricing` | Plan cards with rolling prices, billing toggle, comparison table, FAQ, "A bigger team?" | PRESERVED, claims corrected | Prices unchanged ($49 / $99 / from $299). The comparison table lists only the two server-enforced limits. FAQ uses release wording. The yearly badge reads its discount from the plan data. When live plans fail, the cards say "Confirm current pricing" (mailto) and never start checkout |
| `/security` | Boundary hero, six controls, payload, disclosure | PRESERVED, claims corrected | Two control texts use the Part 3 disclosure: imported traces keep prompts and outputs, and replay outputs are kept as evidence. Adds a section with the release's CMS `security_page` points |
| `/team` | Banner with Zev, founder cards, "Why this exists" | PRESERVED | Third founder Bat-Ochir (no links, as in the release). Three columns from 1100px. Copy says "Three founders" |
| `/privacy`, `/terms` | Editorial legal layout | PRESERVED | Release legal text, last updated 2026-10-12, incl. website analytics, product events and evaluation requests |
| `/download`, `/login`, `/signup`, 404 | Whole pages | PRESERVED | Demo links go to `/product`. Phone inputs are 16px instead of 14px, to stop iOS zoom. Signup keeps `signup_started` analytics |
| `/evaluation`, `/company` | (not in the design) | RESTYLED | Release pages rebuilt from the design's intro, section, feature-row and end components. The evaluation form behaviour is unchanged |
| `/demo/*`, `/design` | Demo workspace, screen index | REMOVED | `/demo/*` redirects to `/product`; `POST /api/optimize/demo` is untouched |
| `/app/*`, `/admin/*` | Workspace styling hooks | APPLIED | The same changes the design branch made to its own app: `workspace-experience` / `admin-experience` classes, ink sidebar, inverse logo, design `Metric` / `Panel`. **Not visually verified signed in**: needs a staging session |

## Numbers from the comparison (unified vs design, same widths)
- **Desktop and mobile:** zero horizontal overflow on all 12 public routes.
- **Home page:** all 10 sections match the design's height and display-type size exactly (hero h1 164px desktop, 78px mobile).
- **Height differences:** only where release content was added on purpose (product features, security points, third founder, legal disclosures, footer disclosure), or removed on purpose (pricing limits rows).
- **Screenshots:** side-by-side captures of every page were produced for review. They are not committed, to keep binary images out of the public repo.

## Decisions for the founders
1. **Headline.** The design's "Make AI lighter." replaces the release's CMS headline "Make AI cheaper without guessing." No public page reads the CMS `hero` or `home` sections any more, so editing them in the admin (or the hero copy in migrations 013/019) changes nothing visible. The `product`, `proof`, `security_page`, `evaluation_page`, `company_page`, `footer`, `contact` and `status` sections still drive their pages. Options: bind the design hero to the CMS, keeping the design text as the default, or hide the Hero and Home editors in the admin. Bat-Ochir to confirm the public wording.
2. **Signed-in app.** It now carries the design's workspace styling, but the vNext screens (Command Center, graph, optimize, enterprise) were built after the design and have not been reviewed in a browser against it.
