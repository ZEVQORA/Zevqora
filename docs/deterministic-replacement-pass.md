# DeterministicReplacementPass v0.2

Code: `passes-intelligence.js#deterministicReplacementPass`, lookup semantics
in `replay-model.js#validatedLookup`.

Proposes replacing a generative call with deterministic work only when the
evidence is clear. Ambiguous semantic work is never replaced to save cost.

## Implemented: validated exact lookup (EXECUTABLE)

**Applicability** — a redundant_call diagnosis whose scope:
- repeats exact inputs, and
- answers with enum labels only (≤ 20 distinct values, each a short token), and
- has at least one request answerable from an earlier validated answer.

Free-text outputs → not applicable ("semantic work, not a deterministic mapping").

| Contract | Value |
|---|---|
| input contract | exact key: symbol, workflow, input hash, system-prompt hash, response format (model-independent: it replaces the model) |
| output contract | `{ type: 'enum', values: [...] }` |
| table | built only from **earlier** labelled history: an observation counts when its recorded output equals its label; a key answers when it has ≥ 1 such observation strictly earlier in time and all of them agree |
| failure mode | unseen or unvalidated input → miss; no answer is invented |
| fallback path | the current model call (baseline path) on every miss |
| rollback | disable the lookup table (flag) |
| replay requirement | full replay under the frozen contract |

Because the table never uses the label of the request being answered, the
replay is not graded against its own answer. In the demo this matters: the
first refund answer for order 1001 was wrong, so a cache that reuses it is
REJECTED, while the validated lookup skips it (its label disagreed) and is
VERIFIED.

The lookup and an exact-response cache on the same call conflict (no declared
precedence). Lookup → smaller model composes (misses go to the model).

## Not implemented (proposed only when evidence exists)

Schema parser, regex extraction, static routing, business rules and structured
transformations would need the raw input content or a rule specification;
ZEVQORA does not read raw content to invent rules. None of them is proposed in
this version.
