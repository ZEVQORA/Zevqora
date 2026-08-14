# ZEVQORA Production v1 — Setup

This bundle is designed to ship the white-only ZEVQORA website and the Windows desktop installer from one repository.

## 1. Supabase

Create/use a Supabase project, then run:

`supabase/migrations/001_zevqora_production.sql`

Set these Auth URLs in Supabase:

- Site URL: `https://zevqora.vercel.app`
- Redirect URL: `https://zevqora.vercel.app/login`
- Redirect URL: `https://zevqora.vercel.app/desktop-auth`
- Local optional: `http://localhost:3000/login`
- Local optional: `http://localhost:3000/desktop-auth`

Enable Email/Password. Enable Google and GitHub only after their OAuth credentials are configured in Supabase.

## 2. Stripe

Create two recurring monthly prices:

- ZEVQORA Pro — `$49/month`
- ZEVQORA Team — `$199/month`

Put their `price_...` IDs into Vercel environment variables.

Enable the Stripe Customer Portal for subscription management.

Register this Stripe webhook URL:

`https://zevqora.vercel.app/api/stripe/webhook`

Required webhook events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Stripe Checkout uses dynamic payment methods by default in this bundle. Do not add a fake Google Pay button. Eligible Google Pay/Apple Pay/Link options are controlled by Stripe, browser, device, country and account eligibility.

## 3. Vercel environment variables

Copy the names from `.env.example` into Vercel Project → Settings → Environment Variables.

Public values:

- `PUBLIC_APP_URL=https://zevqora.vercel.app`
- `PUBLIC_DESKTOP_DOWNLOAD_URL=`
- `PUBLIC_SUPABASE_URL=`
- `PUBLIC_SUPABASE_ANON_KEY=`
- `PUBLIC_CONTACT_EMAIL=zevqora.ai@gmail.com`

Server-only values:

- `SUPABASE_URL=`
- `SUPABASE_SERVICE_ROLE_KEY=`
- `STRIPE_SECRET_KEY=`
- `STRIPE_WEBHOOK_SECRET=`
- `STRIPE_PRO_PRICE_ID=`
- `STRIPE_TEAM_PRICE_ID=`
- `DESKTOP_HANDOFF_SECRET=`
- `CRON_SECRET=`

Generate `DESKTOP_HANDOFF_SECRET` locally with:

`openssl rand -base64 32`

Generate `CRON_SECRET` with a password manager or another cryptographically random generator. Never commit either value.

## 4. Browser → desktop login flow

The desktop app generates a random state and opens:

`https://zevqora.vercel.app/desktop-auth?state=...`

The browser handles Email/Password, Google or GitHub through Supabase. The website then creates an encrypted, short-lived, one-time handoff row and opens:

`zevqora://auth/callback?code=...&state=...`

Electron validates the state, exchanges the one-time code over HTTPS, stores the resulting session using Electron `safeStorage`, and opens the workspace.

The user password never enters the Electron renderer or local Python backend.

## 5. Build the Windows installer

### Option A — Windows machine

From repository root:

`powershell -ExecutionPolicy Bypass -File .\desktop-app\scripts\package_windows.ps1`

Result:

`desktop-app\desktop\release\ZEVQORA-Setup.exe`

### Option B — GitHub Actions

The repository contains `.github/workflows/windows-release.yml`.

- Run it manually to get an Actions artifact.
- Or push a tag such as `v1.0.0`.
- A tagged build creates/uploads `ZEVQORA-Setup.exe` to the GitHub Release.

If you own a Windows code-signing certificate, add repository Actions secrets:

- `WINDOWS_CSC_LINK`
- `WINDOWS_CSC_KEY_PASSWORD`

and pass them to electron-builder in the workflow before public distribution. Without code signing, Windows SmartScreen may warn users even though the installer is legitimate.

## 6. Connect the website Download button

After GitHub creates the release asset, set:

`PUBLIC_DESKTOP_DOWNLOAD_URL=https://github.com/OWNER/REPO/releases/latest/download/ZEVQORA-Setup.exe`

Then redeploy Vercel. `/download` and all Download CTAs will point to the installer.

## 7. If the website domain changes later

Update:

- Vercel `PUBLIC_APP_URL`
- Supabase Site URL/Redirect URLs
- `desktop-app/desktop/config/app-config.json`

Then rebuild the desktop installer. The desktop build must know which browser site owns its auth handoff.

## 8. Production verification checklist

1. `/` loads white-only ZEVQORA landing.
2. `/login` creates a normal browser session.
3. `/pricing` sends authenticated Pro/Team users to Stripe Checkout.
4. Stripe webhook updates `subscriptions` and `credit_balances`.
5. `/account` shows plan and Zev credit from the server.
6. `/download` downloads `ZEVQORA-Setup.exe`.
7. Install the EXE on a clean Windows VM.
8. Launch → Continue in browser.
9. Browser sign-in succeeds.
10. Browser prompts to open `ZEVQORA`.
11. Desktop receives the one-time callback and shows the signed-in plan/credit in the title bar.
12. Sign out removes the locally encrypted desktop session.
13. Restart confirms persistent login when Windows secure storage is available.
14. Free credit resets through the daily Vercel cron; paid credit resets on `invoice.paid`.

