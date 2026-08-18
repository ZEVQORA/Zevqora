# ZEVQORA Website Refresh — deployment checklist

1. **Database**
   - If the existing ZEVQORA production migration is already installed, run only `supabase/migrations/002_username_auth.sql`.
   - For a completely new Supabase project, run `001_zevqora_production.sql`, then `002_username_auth.sql`.

2. **Vercel environment**
   - `PUBLIC_APP_URL`
   - `PUBLIC_DESKTOP_DOWNLOAD_URL` (optional; falls back to latest GitHub release)
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRO_PRICE_ID`
   - `STRIPE_TEAM_PRICE_ID`
   - `DESKTOP_HANDOFF_SECRET`
   - `CRON_SECRET`

3. **Supabase Auth providers**
   - Enable Email/Password.
   - Enable Google.
   - Enable GitHub.
   - Add `https://zevqora.vercel.app/**` (and any custom production domain) to allowed redirect URLs.

4. **Signup behavior**
   - The UI always returns to `/login` after email/password signup.
   - For immediate login without an email-confirmation step, set Supabase email confirmation accordingly.

5. **Installer**
   - Default link: `https://github.com/ZEVQORA/Zevqora/releases/latest/download/ZEVQORA-Setup.exe`.
   - Override with `PUBLIC_DESKTOP_DOWNLOAD_URL` if you later move release hosting.

6. **Deploy**
   - `npm install`
   - Deploy with the same Vercel project/environment used by the existing site.
