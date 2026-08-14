# ZEVQORA v1.0.4

Production desktop-auth reliability hotfix on top of the premium Production v1 build.

- fixes the `Invalid desktop handoff request.` failure caused by incomplete/stale Supabase browser session tokens
- refreshes an incomplete browser session before creating a desktop handoff
- uses the session returned directly by password sign-in to avoid persistence races
- preserves desktop state across Google/GitHub OAuth redirects and signup/login redirects
- returns actionable desktop-auth error codes instead of one ambiguous 400 response
- retains exact approved ZEVQORA mark, wordmark, Zev mascot, white/Soft Blue UI, secure OpenRouter BYOK, and Windows installer workflow
