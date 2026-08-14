# ZEVQORA v1.0.4

Production desktop-auth reliability hotfix.

- preserves the desktop state across Google/GitHub OAuth redirects
- preserves the desktop state through account creation/login redirects
- uses the session returned directly by password sign-in instead of racing local session persistence
- refreshes incomplete Supabase browser sessions before creating a desktop handoff
- validates access/refresh tokens before handoff submission
- replaces the ambiguous `Invalid desktop handoff request.` response with actionable error codes
- keeps the auth form recoverable when a stale browser session exists
- keeps the approved ZEVQORA mark, wordmark, Zev mascot, white/Soft Blue product language, OpenRouter BYOK, and installer contract unchanged
