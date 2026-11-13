# CLAUDE.md

Read `AGENTS.md` first; everything there applies. Extra context for Claude Code sessions:

- Brand tokens: Ink `#0F1115`, Cloud `#F7F8FA`, Soft Blue `#468BFF`, Stone `#E6E9EE`,
  Satoshi Variable. Keep the traced marks in `src/brand/marks.ts` and the Zev
  mascot assets. Reference images are in `ZEVQORA/Web_Design`, branch
  `nero/web-design-v1/references`.
- CEO / CTO / Developer views are presentation modes (`src/lib/mode.ts`), never
  permissions. Roles (`owner/admin/member/viewer`) are checked on the server.
- Plan entitlements are enforced over the billing account in
  `api/_lib/plan-limits.js` (pentest SEC-01/SEC-02, `docs/security/`).
- On Windows: run Vitest with `--maxWorkers=2`; heredoc patch scripts in Bash
  are unreliable, so write edit scripts to the scratchpad instead.
- Current launch status and open blockers: `docs/handoff/17-LAUNCH-2026-11-13.md`.
