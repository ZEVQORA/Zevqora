# ZEVQORA Website Refresh v7

Frontend refinement based on the supplied ZEVQORA design references while retaining the existing Vercel + Supabase + Stripe backend shape.

## V3 fixes

- Login composition refined to match the supplied reference more closely.
- Password eye buttons now work even in local preview mode.
- `Create account` / `Sign in` labels have deliberate spacing and cleaner typography.
- Platform-dependent text glyph icons were replaced with real inline SVG icons.
- Home system rows, Zev proof items, savings gates and signup benefit icons are consistent across browsers.
- Micro-motion was rebuilt: smoother hero tilt, cursor light response, staggered scroll reveals, rail-dot sequencing, card lift, input focus motion, auth image parallax and click ripples.
- Local preview no longer shows the missing-Supabase state as a harsh red production error.
- `START_PREVIEW.bat` was added so clean routes such as `/pricing` and `/login` work locally without Vercel.

## Included product behavior

- Home page with the requested hero and three scroll sections.
- Pricing page with Free / Pro / Team / Enterprise cards.
- Login with **Username or email**, password login, Google OAuth and GitHub OAuth.
- Signup with username, email, password and password confirmation.
- Home session greeting: `Welcome <email-local-part>`.
- `Get ZEVQORA` buttons point at the latest GitHub Windows installer.
- Existing Stripe checkout, account, desktop-session and desktop-handoff API structure retained.
- Server-side username resolver for username-or-email login.

## Fast local preview

On Windows, double-click:

`START_PREVIEW.bat`

Then use normal clean routes such as:

- `http://localhost:5600/`
- `http://localhost:5600/login`
- `http://localhost:5600/signup`
- `http://localhost:5600/pricing`

The local preview server intentionally does not contain production Supabase/Stripe secrets, so authentication/payment actions remain disabled until the project is run with the real Vercel environment.

## Production setup

1. Keep the existing Vercel environment values from the current production deployment.
2. Run `supabase/migrations/002_username_auth.sql` after the existing production migration.
3. Enable Google and GitHub providers in Supabase Auth and register the production redirect URL.
4. Deploy the root directory to the existing Vercel project.

See `SETUP.md` for the deployment checklist.


## V4 precision fixes
- Fixed system-row SVG clipping caused by an overly broad CSS selector.
- Rebuilt Zev evidence card with a dedicated mascot visual column (no copy overlap).
- Password eye now follows standard semantics: slashed/closed eye = hidden, open eye = visible; typing/backspace never changes visibility.
- Replaced remaining glyph-like UI checks/arrows with deterministic CSS/SVG geometry where applicable.


## V6 cinematic polish

- Login background rebuilt with restrained ambient depth: soft blue light, masked dot texture, floating glass orbs and quiet orbital lines behind the form card.
- Login form card now uses a cleaner glass/white surface, deeper soft shadow and subtle edge light while keeping the supplied composition intact.
- Added cinematic internal page transitions with a short white/blue light wipe instead of abrupt page cuts.
- Login → Signup transitions slide left; Signup → Login transitions slide right, with a matching directional entrance on the next screen.
- `How it works` and other same-page hash links use an eased cinematic scroll and a brief destination acknowledgement.
- Added `transition-init.js` so route entrance motion is prepared before first paint and avoids a harsh flash.
- Motion respects `prefers-reduced-motion` and falls back to immediate navigation/scrolling.
- Existing Supabase, Stripe, desktop-session and account backend/API behavior remains unchanged.


## V7 scene + transition pass

- Rebuilt the **entire Zev side of the Login screen**. It is no longer a full-bleed puppy wallpaper: the right side is now a composed product scene with a focused Zev card, concise product copy, replay/quality proof cards, and a four-step evidence rail.
- Removed the decorative orbit/dot clutter from the Login form side so the form reads cleaner and the visual hierarchy is stronger.
- Login ↔ Signup now uses a **same-document scene transition** on modern Chromium browsers. The form panel and visual/story panel receive matching View Transition identities, so they physically trade sides instead of producing an abrupt page cut.
- Added a directional fallback transition for browsers without View Transitions.
- `How it works` now has an explicit cinematic travel state: a small progress HUD appears during the eased scroll, then the Evidence Rail redraws and its six steps enter in sequence.
- Regular internal navigation keeps a longer white/blue optical wipe so page changes are visibly intentional without using large bounces or noisy effects.
- Password eye behavior remains persistent and explicit: typing, Backspace, Delete and focus changes never alter visibility; only the eye button toggles it.
- Auth lifecycle code was made idempotent so the dynamically swapped Login/Signup form can safely re-bind authentication without duplicating listeners.
