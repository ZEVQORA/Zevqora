# Aurora redesign

The public home, account screens, and authenticated workspace share a dark Aurora visual system. CSS/SVG ribbons animate without image downloads and respect reduced motion. The product preview is explicitly labelled; it contains no invented customer or savings metrics.

## Cinematic home

The home now includes a native-scroll, three-chapter pinned scene: noise, signal, and possibility. A bounded canvas particle field, converging context chips, orbital geometry, and a glass brand core respond to scroll progress. The hero recedes as it leaves the viewport, followed by a word-by-word statement reveal. No scroll interception or video downloads are required. The canvas caps pixel density, renders at about 30 fps, and stops offscreen or when the tab is hidden; mobile uses fewer particles. Reduced motion replaces the long pinned timeline with a static composition.

Browser QA covered desktop at 1280 × 720 and mobile at 390 × 844, including all three chapter transitions and horizontal overflow. The home passes the automated axe WCAG checks (contrast excluded by the existing jsdom suite).

## Account flow

Sign-up asks for name, email, and password. The existing database trigger assigns a username, including collision handling. Email confirmation remains enabled according to Supabase settings. After confirmation, a user names their workspace and enters Zev chat. Existing users enter chat directly. Supabase persists and refreshes sessions; the storage key includes the project ref so a session from the old database cannot be reused on the new one.

## Remote repositories

The connection dialog accepts GitHub URLs or creates server workloads for imported runtime evidence. Browser users no longer choose local folders. GitHub scanning uses only `api.github.com`, refuses redirects and sensitive paths, and never executes code. Bounds: 250 supported source files, 250 KB per file, 4 MB total source. A truncated tree is an error, not a successful partial scan. Only call sites and findings are stored. Source reads for change preparation also use the authenticated server API. Private repository access depends on GitHub OAuth permissions; persistent GitHub App background sync is separate and remains unconfigured.

Server workloads currently accept explicit trace imports. Existing telemetry endpoints and adapter guides remain available; telemetry metadata does not automatically become replay evidence.

## Zev helpdesk

Authenticated Zev uses the existing metered platform provider and read-only workspace tools. Its role now includes onboarding, navigation, troubleshooting, and explaining evidence. Public support uses `/api/support/message`, has no private data or tools, and labels its answer mode. `PUBLIC_SUPPORT_AI_ENABLED=true` enables bounded public model answers when `OPENROUTER_API_KEY` is configured. Otherwise it returns product FAQ answers. Public requests have input, output-token, and request-rate limits.

## New Supabase project

- Organization: Zevqora
- Project: Zevqora.ai
- Ref: `dhqagbcaqspdrxcsxgfb`
- API: `https://dhqagbcaqspdrxcsxgfb.supabase.co`
- Repository migrations 001–020 installed, with migration history recorded.
- Verified after bootstrap: 51 public tables, all with RLS; anonymous profile reads and direct authenticated profile writes refused; service-role engine writes allowed.
- Existing users and data from the old account are not copied by this bootstrap.

Runtime configuration must provide `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (accepts a modern publishable key), `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` (accepts a modern secret key). The secret key must be server-only. Local `.env.local` is ignored by Git. Vercel preview variables should be scoped to the redesign branch; configure production separately before release.

Supabase Site URL should be `https://zevqora.vercel.app`. Allow authentication redirects for the production origin, the actual preview origin, and development when needed. OAuth buttons are rendered only for providers that Supabase has actually enabled.

## Validation

Run `npm run check` and `npm run verify:release`. CI also verifies API module imports and scans tracked source for secret patterns. GitHub scans, source path restrictions, onboarding retries, session restoration, public support modes, and public/private boundaries have automated coverage. Browser QA must cover home navigation, account forms, support, personalized chat, and page reload with a real session.
