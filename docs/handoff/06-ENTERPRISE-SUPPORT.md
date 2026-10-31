# Enterprise and Support Backend Handoff

## Shipped public FAQ boundary (applied and tested 2026-10-31)
`SupportZevLauncher` is a finite source-linked public FAQ. It has no `fetch` and does not invoke `/api/engine/agent/chat`, `/api/support/messages` or workspace state. UI labels **Public FAQ · Not a live agent**. Supports open, close, Esc, focus cycling/return, responsive bottom-sheet sizing, links to existing public pages and verified `contact.email` mailto fallback.

Verified: jsdom test (no `fetch`, Esc closes, focus returns, axe clean) and a local browser at 375px (panel 343×567px inside the viewport, Tab/Shift+Tab wrap inside the dialog, no request from the panel). Fixed during integration: focus did not return to the sticker after Esc, because the trigger is unmounted while the panel is open.
The signed-in product `ZevView.tsx` and `/api/engine/agent/chat` remain unchanged and independently server-authorized.

### Future generative public API — NOT_CONNECTED
- Proposed `POST /api/support/messages`: `PublicSupportMessageRequest { idempotency_key, thread_id, message, public_context: {page} }`, `PublicSupportMessageResponse {thread_id,answer,answer_mode,source_refs,created_at}`.
- Proposed `POST /api/support/tickets`: `PublicSupportTicketRequest {idempotency_key,email,message,consent_to_contact}`, returns opaque ID/status and truthful expectations.
- Must have curated public-only knowledge, no workspace data joins, token-bucket/IP abuse limits, retention and deletion policy, safe text redaction, prompt injection defenses, audit/request ids and no fake live human/24h claims.
- Frontend mode stays `public_faq` until verified capability and approved backend UI adaptation. Never silently set mode to generative.

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
