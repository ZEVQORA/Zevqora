# Build status

## Web
- Static source smoke-tested through a local HTTP server.
- Main page, premium stylesheet, dashboard asset, and brand mark all returned successfully.
- HTML injection and JavaScript syntax checks passed.

## Desktop
- Current production v1.0.6 desktop source is included.
- Roman/Times serif Settings heading removed at source level.
- Italic Zev thinking-state UI removed at source level.
- Added final shared sans/Soft Blue brand layer.
- Full `npm install` could not complete in the packaging environment because external dependency installation timed out. No TypeScript logic was changed by this refresh; the desktop changes are CSS + one stylesheet import.

To verify/build on a normal development machine:

```powershell
cd desktop-app\desktop
npm install
npm run typecheck
npm run build
```

For the full Windows installer, use the production packaging script from the repository once this refresh is overlaid there.
