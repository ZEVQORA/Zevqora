# ZEVQORA v1.0.5

## Desktop authentication simplification

- Removes browser handoff from the primary desktop sign-in path.
- Adds direct email/password sign-in inside ZEVQORA Desktop using the existing Supabase account.
- Credentials are sent directly from the Electron main process to the configured Supabase Auth HTTPS endpoint.
- Only access/refresh session tokens are stored, encrypted with Electron `safeStorage` when available.
- A valid stored session opens the workspace automatically on future launches.
- The website remains the place to create/manage an account; Google/GitHub OAuth stays web-side for now.
- Legacy browser handoff endpoints remain for compatibility but are no longer used by the desktop welcome screen.
