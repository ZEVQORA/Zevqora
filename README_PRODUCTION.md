# ZEVQORA Production v1

**Product:** AI Cost Optimization Engineer for AI products  
**Primary outcome:** Cut AI COGS without cutting product quality.  
**Brand:** white/Cloud + Soft Blue only. No dark mode.

## What is included

- Premium white-only marketing website.
- Real Supabase email/password + Google/GitHub browser auth wiring.
- Browser-to-Electron one-time auth handoff using `zevqora://auth/callback`.
- Electron session persistence through OS-backed `safeStorage` when available.
- Stripe subscription Checkout for Pro/Team.
- Stripe Customer Portal.
- Signature-verified Stripe webhook provisioning.
- Plan + Zev credit account page.
- Free-credit daily reset cron.
- Current ZEVQORA desktop Living Workspace UI.
- Packaged FastAPI local backend sidecar.
- NSIS Windows installer build configuration.
- GitHub Actions Windows installer/release workflow.
- Stable website download URL configuration.
- Exact current ZEVQORA/Zev brand assets.

## Repository layout

```text
/
├── index.html                     website
├── login.html / signup.html       browser account auth
├── desktop-auth.html              desktop browser auth bridge
├── account.html                   plan + credits + billing portal
├── pricing.html                   Stripe subscription checkout
├── download.html                  installer download
├── api/                           Vercel server functions
├── supabase/migrations/           production database schema
├── desktop-app/                   Electron + FastAPI desktop product
├── .github/workflows/             Windows installer builder
├── PRODUCTION_SETUP.md            exact setup instructions
└── .env.example                   placeholders only
```

## Important

No real secrets are included in this ZIP. Do not add a real `.env` file to Git. Put production secrets only in Vercel/Supabase/Stripe/GitHub Actions secret settings.

The bundle intentionally contains source and build automation, not a precompiled Windows EXE. This environment cannot access npm/PyPI, so it cannot safely fetch Electron/PyInstaller dependencies to compile the installer here. `windows-release.yml` or `package_windows.ps1` produces the actual `ZEVQORA-Setup.exe`.

See `PRODUCTION_SETUP.md`.
