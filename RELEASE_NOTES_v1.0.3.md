# ZEVQORA Production v1.0.3

## Release blocker fixes

- Restored the desktop exports required by `App.tsx`: `ExperimentDialog`, `ImplementationDialog`, and `WorkspaceControl`.
- Added a release preflight that fails before packaging when required desktop contracts or approved brand assets are missing.
- Kept the Windows packaging flow on `windows-latest` and stable release artifact name `ZEVQORA-Setup.exe`.

## Brand integrity

- Uses the approved ZEVQORA mark, wordmark, lockup, Zev mascot/avatar, and Living Workspace image.
- Verifies approved asset SHA-256 checksums before building the installer.
- Uses packaged-relative brand paths so Electron production builds resolve assets correctly.
- White / Cloud / Soft Blue product language only; no dark-mode fallback.

## Product / auth polish

- Compact premium browser login/signup/desktop-auth surfaces.
- Google and GitHub OAuth buttons are icon-first.
- Desktop auth invalid-state is a branded recovery surface instead of a raw error line.
- Browser-to-desktop `zevqora://auth/callback` handoff remains one-time and state-bound.

## Zev + OpenRouter

- OpenRouter agent integration remains in the local FastAPI backend.
- Desktop Settings supports device-local OpenRouter BYOK.
- Provider key storage uses Electron `safeStorage`; the renderer never receives the saved secret.
- Changing/removing the key restarts the packaged local backend with the updated provider configuration.

## Verification performed in the build workspace

- Release preflight: PASS.
- FastAPI backend tests: 9/9 PASS.
- Windows NSIS compilation is expected to run in GitHub Actions / a Windows machine with package registry access.
