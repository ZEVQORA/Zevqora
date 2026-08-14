# Desktop security + runtime notes

- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- File selection uses narrow preload IPC methods.
- Secret-bearing-looking trace filenames are rejected.
- Browser login state is generated with cryptographic randomness in the Electron main process.
- Browser auth callback must match the pending state before the code is exchanged.
- Session tokens are never placed directly in the custom-protocol URL.
- The browser hands only an opaque one-time code through `zevqora://auth/callback`.
- Stored session data uses Electron `safeStorage` when OS encryption is available; otherwise it remains memory-only.
- No dark-mode code or theme toggle is included in Production v1.
- The local engine binds to `127.0.0.1`.
- Human review remains required for prepared code changes.
