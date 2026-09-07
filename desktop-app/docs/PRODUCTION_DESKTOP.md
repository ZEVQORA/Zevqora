# ZEVQORA Desktop — production notes

ZEVQORA is desktop-first. The core product loop runs in this app against the
local engine: local repository → AI usage detection → spend diagnosis →
opportunities → candidate → replay/eval → quality gate → verified savings →
evidence → patch/branch/PR → human review. The website is for marketing,
pricing, sign-up/in, account, team, billing/credits/usage, security, docs and
the admin control centre.

## Process model

- Electron main (`electron/main.cjs`) — owns the account session, the local
  engine process, file dialogs, the tray and every outbound network call that
  carries the session token.
- Renderer (`src/`) — React + Tailwind. `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, CSP in `index.html`. It never sees
  a bearer token or a provider key.
- Local engine (`../backend`, FastAPI) — bound to `127.0.0.1:8000`, protected by
  a per-launch shared token (`X-Zevqora-Token`) that the renderer obtains over
  the preload bridge. Host header allowlist blocks DNS rebinding.

## Account and platform compute

1. Sign-in: email/password goes straight to Supabase Auth over HTTPS, or the
   browser handoff (`/desktop-auth` → `zevqora://auth/callback` with a one-time
   code, state-checked). Only the resulting access/refresh tokens are stored,
   encrypted with `safeStorage`; without OS encryption they stay memory-only.
2. Account state (`/api/me`): user, profile, plan, credit, workspaces + roles.
   The active workspace/project is a device preference (`preferences.json`).
3. Platform session hand-off: main pushes the access token plus the active
   workspace/project into the engine over `POST /api/v1/platform/session`
   (token-protected local API). The engine keeps it in memory only and reports
   just a fingerprint.
4. Model calls: with no device-local key, the engine's OpenRouter provider
   points at `{platform}/api/platform/chat/completions` with the access token.
   The server authorizes, checks plan and Zev credit, rate-limits, forwards to
   OpenRouter with the platform credential, and charges the provider-reported
   cost to the billing owner (idempotent by provider request id). The provider
   credential never exists on the device, in the binary, in env, or in logs.
5. Optional BYOK: a device-local OpenRouter key (OS-encrypted) bypasses
   platform credit. Local key wins over the platform session when both exist.
6. Pricing: on session hand-off the engine pulls public list prices from
   `GET /api/platform/pricing` so replays can be budgeted before they spend.

## Platform routes reachable from the renderer

The preload exposes `platformRequest(method, path, body)`. Main attaches the
bearer token and allows only `/api/(me|platform|workspaces|projects|connections|opportunities|experiments|invites)` with GET/POST/PATCH/DELETE. Used for Live
Runtime (`/api/projects/:id/runtime`), connections (create/revoke/rotate) and
project listing/creation. Nothing else is reachable.

## Replay → evaluation → change

- "Let Zev test it" runs `optimization/plans` → `execute` → `evaluations`.
  Plans are deterministic; execution is bounded by the spend cap; evaluation
  applies deterministic graders and gates (`minimum_samples`, `quality_floor`,
  `cost_improvement`, `latency_regression`, `fallback`, `protected_cases`,
  `evidence_completeness`). Only an execution-proven VERIFIED evaluation can
  prepare a change.
- Prepared changes live in an isolated Git worktree on a new branch. The
  reviewer can open the worktree, approve for review, reject, push the branch
  (`git push -u origin <branch>` with the user's own Git credentials) and open a
  pull request in the browser. ZEVQORA never merges or deploys. No SSH.

## Trust boundary

- Source scan reads `.py/.js/.jsx/.ts/.tsx/.mjs/.cjs` up to 1 MB; skips `.git`,
  dependency and build folders and anything named like a secret.
- Trace import is explicit; secret-looking file names are refused; 50 MB cap.
- Files containing secret-like values are never sent or rewritten.
- External links open only for the ZEVQORA site and GitHub/GitLab/Bitbucket.
- Admin functionality is web-only.

## Build

`powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1` builds
the PyInstaller sidecar and the NSIS installer (`desktop\release\ZEVQORA-Setup.exe`).
Set `desktop/config/app-config.json` → `webAppUrl` to the production site first.
