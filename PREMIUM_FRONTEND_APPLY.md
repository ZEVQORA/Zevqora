# ZEVQORA Premium Frontend v1.0.1

This release replaces the generic browser auth presentation and fixes packaged desktop brand assets.

## What changed

- Browser `/login`, `/signup`, and `/desktop-auth` are rebuilt in the same visual language as ZEVQORA Desktop.
- The actual `living-workspace-light.png` product render is used as a real `<img>` element with controlled crop/object-position.
- The exact ZEVQORA mark, wordmark, and Zev mascot are reused; no generated replacement assets.
- Invalid `/desktop-auth` requests now show a branded recovery state instead of a raw red error line.
- Electron brand paths now use the Vite base URL so `file://` packaged builds resolve `brand/*` correctly.
- The Living Workspace preview is packaged into the desktop app and shown on the desktop welcome screen.
- Version bumped to `1.0.1`.

## Apply to existing local Git repository

If you use the separate patch ZIP, run `APPLY_TO_EXISTING.ps1` from the extracted patch folder.

Then from your repo:

```powershell
cd "C:\Users\manka\Downloads\ZEVQORA_Production_v1\ZEVQORA_Production_v1"

git status
git add .
git commit -m "Polish ZEVQORA premium auth and fix desktop assets"
git push origin main
```

Vercel will redeploy the website from `main` automatically.

## Build/publish the corrected desktop installer

The current v1.0.0 installer still contains the old desktop UI/assets. Publish v1.0.1 after pushing `main`:

```powershell
git tag -a v1.0.1 -m "ZEVQORA v1.0.1 premium auth polish"
git push origin v1.0.1
```

The existing GitHub Actions workflow will build and publish a new `ZEVQORA-Setup.exe` release asset.

Because the website download env uses:

```text
https://github.com/ZEVQORA/Zevqora/releases/latest/download/ZEVQORA-Setup.exe
```

it will automatically resolve to the newest release after v1.0.1 finishes.

## Secrets

This patch does not add or modify real `.env` files and does not embed Supabase/Stripe secrets in frontend code.
