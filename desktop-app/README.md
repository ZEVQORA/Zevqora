# ZEVQORA Desktop — Production v1

White-only Electron desktop app + packaged local FastAPI engine.

## Auth

The app does not collect account passwords. `Continue in browser` opens the configured ZEVQORA web app, and a short-lived one-time handoff returns through `zevqora://auth/callback`.

## Build

On Windows:

`powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1`

Output:

`desktop\release\ZEVQORA-Setup.exe`

## Website URL

Edit `desktop/config/app-config.json` before building if the public account/billing site is not `https://zevqora.vercel.app`.

## Local engine

The packaged installer bundles the FastAPI backend as `zevqora-backend.exe` and stores its SQLite database under the Electron user-data directory.

Full conversational OpenRouter reasoning remains optional: the local engine has deterministic scan/finding/spend tools without a provider key. If you later wire hosted Zev compute to billing credits, keep provider secrets server-side rather than baking them into the installer.
