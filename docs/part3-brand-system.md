# Part 3 brand system

The two approved boards — the **Brand System v1.0** board and the **Zev 360
Character Turnaround** — are the visual authority. This document records how
the product implements them; it does not reinterpret them.

## Canonical values (already in the repository, kept exactly)

| Board name | Token | Value | Use |
|---|---|---|---|
| Ink | `--zq-ink` | `#0F1115` | text, dark lockup surface, footer |
| Cloud | `--zq-cloud` | `#F7F8FA` | page canvas |
| Soft Blue | `--zq-blue` | `#468BFF` | mark, accents, focus, charts |
| Stone | `--zq-stone` | `#E6E9EE` | borders, quiet surfaces |

Derived tones (`--zq-blue-700 #2F6FDC` for text-on-white contrast, `--zq-ink-500`,
`--zq-stone-300`, …) and the three verdict colours (verified green, rejected red,
warning amber) were already defined in `src/styles/globals.css`; Part 3 adds no
new hue. Verdicts are never colour-only: each carries an icon and an uppercase word.

* **Type** — Satoshi Variable, self-hosted (`public/fonts/Satoshi-Variable.woff2`,
  ITF Free Font License), `font-display: swap`. Heading bold/large, subheading
  medium in Soft Blue, body regular — as on the board's typography panel.
* **Wordmark and mark** — `src/brand/marks.ts` holds the paths machine-traced from
  the board (98.8% / 98.1% IoU). `ZevqoraLogo`, `ZevqoraMark`, `ZevqoraWordmark`
  render them; there is no colour prop on the mark (it is always Soft Blue) and the
  lockup ratios (mark : cap height 2.125, gap 0.529) are locked. The wordmark is never
  typeset in a font.
* **App icon** — Soft Blue rounded square with the white Z, as on the board
  (`AppIcon` in `src/brand`).
* **Dark mode lockup** — inverse wordmark on Ink with a rounded container, as on the
  board. Product surfaces support `[data-surface="ink"]` and a user-selected dark theme;
  light is the default.

## Zev

Zev is the approved white puppy with blue ears, blue collar and the Z medallion.
The sprites in `public/assets/zev/` were extracted from the turnaround board
(front, three-quarter, side, back, four poses, six expressions) and are rendered by
`src/brand/Zev.tsx` without redrawing or upscaling past the source.

Where Zev appears in Part 3, deliberately and sparingly:

| Place | Sprite | Why |
|---|---|---|
| Website hero companion card | `three-quarter-front` | friendly introduction, like the board's "Hi, I'm Zev." |
| Website "who it's for" / evaluation CTA | `pose-waving` | invitation |
| Onboarding steps | expressions | reassurance while setting up |
| Empty states (no workload, no traces, no verified plan) | `pose-thinking`, `pose-sitting` | calm, never hiding an error |
| Success moment (a plan is VERIFIED and selected) | `delighted` face | one moment, not a celebration screen |
| Command Center footer note | `calm-confidence` face | the board's "Zev is keeping things light" pattern, with honest copy |

Zev never appears inside dense tables, charts, the graph canvas, admin security views
or error states that need attention.

## Surfaces and components

* Cards: white on Cloud, 16 px radius (22 px for hero panels), 1 px Stone border,
  the soft `--shadow-lift` shadow. No heavy glass; glass is kept for the sticky top
  bar and popovers only.
* Chips: rounded, mono uppercase for evidence states (`VERIFIED`, `REJECTED`,
  `INCOMPLETE`, `ESTIMATED`, `PROJECTED`, `NOT YET MEASURED`).
* Icons: Lucide line icons at 1.75 stroke — matching the board's thin line icons.
* Charts: Soft Blue primary series, Ink secondary, Stone gridlines; estimated and
  projected series are dashed, simulated series hatched; realized is shown only when
  measured.
* Motion: opacity/translate only, 120–560 ms, `cubic-bezier(0.2,0,0,1)`; everything
  stops under `prefers-reduced-motion`.

## Not allowed

Neon, cyberpunk, purple gradients, decorative 3D, a new logo, a redrawn or robot
mascot, a serif wordmark, fake metrics styled like the board's illustrative
"Cost Saved $12.4K" card. The board's product preview is a style reference; its
numbers are illustrations and never appear as data.
