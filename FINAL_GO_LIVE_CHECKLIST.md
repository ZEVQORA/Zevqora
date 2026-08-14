# ZEVQORA v1.0.2 — Final go-live checklist

## 1. Apply and publish code
- Apply `ZEVQORA_v1.0.2_PATCH.zip` over the current local repository.
- Push `main`.
- Tag `v1.0.2` to trigger the Windows installer workflow.

## 2. Supabase social OAuth
Use the callback URL shown in Supabase Authentication → Sign In / Providers:
`https://<PROJECT_REF>.supabase.co/auth/v1/callback`

Google:
- Google Auth Platform → OAuth client → Web application.
- Authorized JavaScript origin: `https://zevqora.vercel.app`
- Authorized redirect URI: Supabase callback URL.
- Paste Client ID + Client Secret into the Supabase Google provider.

GitHub:
- GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
- Homepage: `https://zevqora.vercel.app`
- Authorization callback URL: Supabase callback URL.
- Paste Client ID + Client Secret into the Supabase GitHub provider.

Supabase URL Configuration:
- Site URL: `https://zevqora.vercel.app`
- Allowed redirects: `/login`, `/signup`, `/desktop-auth` on the production domain.

## 3. OpenRouter
Packaged desktop:
- ZEVQORA → Settings → Zev · OpenRouter.
- Paste `sk-or-v1-...` and choose Save securely.
- Default model is `openrouter/auto`.

The key is encrypted via Electron OS secure storage and is not committed to GitHub or bundled into the installer.

Development fallback:
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
- `OPENROUTER_SITE_URL=https://zevqora.vercel.app`
- `ZEVQORA_AGENT_MODEL=openrouter/auto`

## 4. Verification
- Backend tests: 9/9 passing in the prepared v1.0.2 source.
- Web/Electron JavaScript syntax checks passing for changed JS/CJS files.
- Rebuild the Windows installer via GitHub Actions after tagging v1.0.2.
- Test flow: Website → Signup/Login → Download → Install → Desktop email/password sign-in → automatic workspace entry → Settings → OpenRouter → Zev.

## 5. Demo video
`demo/ZEVQORA_MVP_Production_v1_Demo.mp4`
- 1920×1080
- 30 fps
- 21.5 seconds
- silent product teaser
