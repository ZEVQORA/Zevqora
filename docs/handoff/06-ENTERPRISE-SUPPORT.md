# Enterprise and Support Backend Handoff

## Public Ask Zev on the homepage (branch nero/homepage-ask-zev, 2026-11-13)
Replaces the FAQ-only `SupportZevLauncher`. One composer (`src/marketing/askzev/AskZev.tsx`) sits under the hero headline and docks bottom-right past the hero; the same DOM node moves, so draft, thread and focus carry over. It calls `POST /api/support/message` (`api/_lib/handlers/support.js`) without auth.

- Knowledge: `api/_lib/support/knowledge.js`, public website facts only. No tenant data, no database reads, no tools.
- Modes: `faq` (default, labelled **Guide / FAQ**) and `ai` (labelled **AI answer · public info only**). `ai` runs only when `PUBLIC_SUPPORT_AI_ENABLED=true`, `OPENROUTER_API_KEY` is set, the durable limiter answered and the daily budget (`PUBLIC_SUPPORT_AI_DAILY_CAP`, default 300) has room. Provider errors fall back to the FAQ answer.
- Bounds: message ≤ 800 chars, ≤ 6 history turns / 3,000 chars, body ≤ 16 KB, `max_tokens` 320, answer ≤ 1,400 chars, 15 s timeout.
- Limits: in-memory 10/min per instance, plus durable 8/min and 80/day per visitor and the global AI budget via `public_rate_limit_hit` (migration 021, rollback in `supabase/rollback/`). Bucket keys hold an HMAC of the address, never the address. Without 021 the route still serves FAQ answers and keeps AI off.
- Privacy: visitor messages are not stored or logged by the route; the browser keeps the thread in memory only.
- Suggestions: at most 2 per browser session, section-aware, dismissible, shown next to the launcher and never as a message.

Tests: `tests/support-message.test.ts`, `tests/support-rate-limit-db.test.ts`, `tests/ask-zev.test.tsx`.
The signed-in product `ZevView.tsx` and `/api/engine/agent/chat` remain unchanged and independently server-authorized.

### Still not built
- `POST /api/support/tickets` (`email`, `message`, `consent_to_contact`): no human ticket path yet; the assistant points to the team email and the evaluation form.

## Enterprise UI, not activated enterprise infrastructure
`/app/enterprise` is new role-aware overview under existing AppShell. Shows workspace and real `activeWorkspace.role` from session. It presents SSO/SCIM/private deployment/advanced audit/region/procurement as **request setup / planned / not connected**. It does not save settings or certify SOC2/HIPAA/SAML. Owner/admin can open an explicit prefilled mail draft; other roles are told to request permission. No ticket is reported as submitted.

### Proposed authenticated enterprise capability endpoint
`GET /api/workspaces/:id/enterprise/capabilities` → `EnterpriseCapability[]` (feature, availability, description, verifiedAt); no default-enabled results. Implement authorization using real workspace role, not current view mode. Advance to `'available'` only from tested server configuration and signed terms.

### Proposed public enterprise request endpoint
`POST /api/enterprise/requests` with server-validated contact, selected requirements, consent, anti-spam, idempotency, retention. An email draft does not equal server submission. Report legal/security/operations dependencies separately.

## Enterprise trust requirements
- Explicit org/workspace ownership and actor, SSO provider state+domain verification, SCIM revocation/lag, tenant-safe audit, client/procurement agreements, retention and secure support queue.
- No customer raw traces in public support/marketing or support analytics. Feature flag/admin audit history for any enabled security control.
- Secrets/SSO private keys in server vault only; no API mutation until backend implementations pass role/tenant tests.

## Acceptance
Keyboard and mobile support, no public private-data access, no unsolicited requests, honest fallback; viewer cannot activate enterprise settings; owner cannot create fake entitlement; global admin never acquires tenant data merely via CEO/CTO presentation choice.

## Enterprise screen as integrated (2026-10-31)
`/app/enterprise` shows the workspace name and the role returned by `/api/me`, a table of existing actions with the minimum role the API enforces (`src/lib/contracts/roles.ts`, drift-tested against handler source) and whether the signed-in role clears it, and the `verified_optimization_vnext` flag state. Every enterprise capability is PROPOSED / REQUEST SETUP / CONTACT SALES; there is no enterprise capability endpoint. Owner/admin see a pre-filled mailto; viewers and members are told to ask an administrator. The view makes no network request (tested).
