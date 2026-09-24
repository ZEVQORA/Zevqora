# UpDoer: two separate engagements

These are different things with different owners. Do not merge them into one plan or one report.

## 1. UpDoer QA trial: UpDoer tests ZEVQORA

UpDoer acts as a QA team on one stable ZEVQORA workflow. ZEVQORA is the system under test.

Needed before it starts:

- One stable ZEVQORA workflow to test end to end (proposed: sign up → onboarding with a workload trace export → first analysis → test a supported opportunity → Evidence → evaluation report).
- A staging environment and test accounts for UpDoer. Production is not the test target.
- The existing requirements and tests for that workflow (`tests/`, this repo's CI) so UpDoer tests against written expectations.
- AI-specific risks to probe: a cheaper candidate that must be REJECTED, missing evidence that must return INCOMPLETE, unknown cost that must never read as $0, a lowered quality floor that must not produce VERIFIED.
- Edge cases and expected behavior, written down: empty import, malformed JSONL, a viewer trying to run an experiment, a suspended account, an unconfirmed data boundary.

Output: defects and a pass/fail against the written expectations. Not an evaluation of UpDoer's AI.

## 2. UpDoer design-partner evaluation: ZEVQORA evaluates UpDoer's AI workflow

ZEVQORA evaluates one existing, authorized UpDoer AI workflow. This is the product's Evaluation record (`/app/evaluation`).

Needed before evidence is imported:

- Written authorization for that one workflow, and the data boundary confirmed in the product.
- A representative or redacted trace export with recorded prompts, outputs, expected answers, cost and latency, and the cases that must never regress marked `"protected": true`.
- Evaluation requirements frozen on the project (quality floor, minimum cases, protected and latency requirements).
- Measurable success criteria agreed with UpDoer.

Output: the evaluation report: baseline, verdicts, measured impact on the evaluated cases only, recommendation, limitations and the next decision. No production projection unless it is explicitly modelled.
