# License decision (owner approval required)

**Status:** no `LICENSE` file. `package.json` has `"private": true`. The
GitHub repository `ZEVQORA/Zevqora` is **public**, so anyone can read the code,
but without a license nobody gains a right to use, copy or modify it (all
rights reserved by default).

## Recommendation: proprietary, and make the repository private

ZEVQORA sells its engine (ZevIR, OptimizationPasses, plan search, the proof
loop). An open-source license (MIT/Apache-2.0) would let competitors run it
commercially. Recommended steps:

1. Add a short proprietary `LICENSE` ("Copyright (c) 2026 <legal entity>. All
   rights reserved. No license is granted.") once the legal entity name is
   confirmed.
2. Switch the GitHub repository to **private**. The current public visibility
   exposes architecture, security controls and migration history to anyone,
   which matters more than the license text.
3. Confirm contributor IP: every contributor (founders, CTO, contractors,
   AI-assisted commits) should have signed IP assignment to the company.

## Third-party assets to keep compliant

| Asset | Path | License | Note |
|---|---|---|---|
| Satoshi Variable | `public/fonts/Satoshi-Variable.woff2` | Fontshare (Indian Type Foundry) free font license | Commercial web use is allowed; redistributing the font files is not. Keep it self-hosted and do not ship it in a downloadable package. Verify the exact terms on fontshare.com. |
| Space Grotesk | `public/fonts/space-grotesk/` | SIL OFL 1.1 (`OFL.txt` included) | OK; keep `OFL.txt` next to the files |
| npm dependencies | `package-lock.json` | mostly MIT / Apache-2.0 / ISC | Run a license audit (e.g. `npx license-checker --summary`) before distributing the desktop app |

Decision needed from: CEO (license type, entity name, repository visibility).
