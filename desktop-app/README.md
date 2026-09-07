# ZEVQORA Desktop

The core ZEVQORA product: an Electron shell around a local FastAPI engine.

Flow: connect a local repository → detect AI usage → import execution traces →
diagnose spend → opportunities → "Let Zev test it" (plan → replay → grade →
quality gate) → verified savings with an evidence trail → isolated patch on a
branch → push / pull request → human review. Never auto-merge, never auto-deploy.

## Auth

Sign in with the same ZEVQORA account as the website (email/password, or the
browser handoff for Google/GitHub). Only session tokens are stored, encrypted
with Electron `safeStorage`. The renderer never sees them.

## Compute

Model calls go through your ZEVQORA account: local engine → `/api/platform/chat/completions`
with your session → plan/credit check → OpenRouter. The provider credential
stays on the server. A device-local OpenRouter key (Settings → Bring your own
key) is optional and bypasses platform credit.

## Develop

```
# backend (engine)
cd backend && python -m pip install -r requirements-dev.txt && python run_backend.py

# desktop
cd desktop && npm install && npm run dev
```

The engine mints a per-launch API token and writes it to `~/.zevqora/api-token`
for the dev flow; Electron reads it and hands it to the renderer.

## Build (Windows)

`powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1`

Output: `desktop\release\ZEVQORA-Setup.exe`. Edit `desktop/config/app-config.json`
if the account site is not `https://zevqora.vercel.app`.

## Tests

- Engine: `cd backend && python -m ruff check . && python -m pytest -q`
- Desktop: `cd desktop && npm run typecheck && npx vite build`

See `docs/PRODUCTION_DESKTOP.md` for the security model.
