# ZEVQORA — Type edition

The method and account pages use typography as the primary visual. They contain no illustration, sculpture or decorative canvas. The four method chapters now keep one fixed Ink surface, with Cloud and Cobalt type. This revision changes only those chapters; account pages and all other frontend areas retain the previous design.

## Four method chapters

| Chapter | Typographic statement | Surface | Product meaning |
| --- | --- | --- | --- |
| Observe | EVERY / CALL COUNTS. | Ink with cobalt | Establish a measured execution baseline |
| Challenge | SAME WORK. / LIGHTER WAY. | Ink with cobalt | Replay the same work on a bounded candidate |
| Verify | CHEAPER? / PROVE IT. | Ink with cobalt | Check the quality floor and every required gate |
| Release | YOUR REVIEW. / YOUR CALL. | Ink with outlined type | Keep the final approval with a person |

Desktop uses a pinned stage with damped progress. All four oversized Space Grotesk statements sit in one continuous vertical type reel. Scrolling carries each phrase upward through a clipped window, with a reading hold before the next phrase arrives. The first line is solid Cloud; the second has a thin Cobalt outline. No chapter changes the background or palette. Selecting a chapter moves the scroll position to its phrase, and the description, terms and destination update from the same chapter record.

Small screens use ordinary page flow and manual selectors above the headline. The selector moves the same reel with an eased transform. Reduced motion uses a static layout and immediate text changes. A single labelled heading exposes the active phrase to assistive technology; the visual reel slides are decorative. All text is real HTML; the method contains no image or canvas nodes.

## Sign in and Create account

A full-width page replaces the framed split card. The cobalt side is an oversized typographic poster: BACK TO / BIG / IDEAS. for returning users, BUILD / WHAT’S / NEXT. for new users. The form sits directly on the paper surface.

The composition includes:

- Original canonical brand lockup in the header.
- A clear alternative account action in the header and near the form.
- Masked word entrances and staggered field entrances.
- A font-weight and rule response when the form has focus.
- Provider controls, labelled underline fields and a strong primary action.
- Independent password and confirmation visibility controls.
- Existing required, email, minimum-length, confirmation and terms checks.
- A compact mobile type banner and single-column signup fields.

The existing authentication API calls, provider configuration, redirects and session handling remain connected through the original page logic. The static design deployment displays its unconfigured preview state and disables real authentication actions.

## Branding and page coverage

Display type is self-hosted Space Grotesk; body type is the existing Satoshi. Canonical logo geometry and brand assets remain in the brand components. Asset provenance and font licenses are recorded in `docs/lighter-engine-assets.md`.

The `/design` catalogue still covers 53 public, authentication, engineering, workspace/state and administrative entries, with native desktop/tablet/mobile previews. Workspace and admin demos remain separate from protected application routes.

The home hero, product preview controls, evidence report, pricing and other page families remain part of the complete source. The evidence report uses the internal benchmark and retains its confidence-interval and sample limitations. The static build uses labelled reference plans when live plans are unavailable.

## Main files

| File | Role |
| --- | --- |
| `src/marketing/TypeMethod.tsx` | Four typographic chapters and scroll selection |
| `src/auth/AuthShell.tsx` | Account poster, open form surface and shared controls |
| `src/auth/LoginPage.tsx` | Sign-in form and existing authentication flow |
| `src/auth/SignupPage.tsx` | Account creation form and existing validation |
| `src/auth/PasswordInput.tsx` | Independent reveal controls and signup hint |
| `src/styles/type-edition.css` | Typography, palette, responsive layout and interaction |
| `src/marketing/DecisionEvidence.tsx` | Internal benchmark decision report |
| `src/brand/EngineFilm.tsx` | Ambient optical hero background |
| `src/brand/RollingPrice.tsx` | Monthly/yearly digit transitions |
| `src/design/DesignIndex.tsx` | Full screen catalogue |

## Run and build

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm run test
npm run verify:release
npm run build
```

For the isolated static design deployment:

```bash
VITE_DESIGN_PREVIEW=true npm run build
```

Open `/design`, `/login`, `/signup` and `/how-it-works` to review the changed areas. The published catalogue includes the complete source ZIP and a binary-safe patch against the original repository base.
