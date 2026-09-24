import type { EvalGate, Evaluation } from './types';

export interface VerdictExplanation {
  status: 'VERIFIED' | 'REJECTED' | 'INCOMPLETE' | string;
  passed: EvalGate[];
  failed: EvalGate[];
  missing: EvalGate[];
  informational: EvalGate[];
  /** For INCOMPLETE: the exact evidence to add before re-running. */
  nextEvidence: string[];
  headline: string;
}

export const GATE_LABEL: Record<string, string> = {
  evidence_completeness: 'Evidence completeness',
  minimum_samples: 'Minimum samples',
  quality_floor: 'Quality floor',
  non_inferiority: 'Non-inferiority',
  protected_slice: 'Protected cases',
  cost_improvement: 'Cost improvement',
  latency_regression: 'Latency regression',
  fallback: 'Fallback',
  execution_success: 'Execution success',
};

function observedNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** What to do about one missing gate, in the words a user can act on. */
function nextStepFor(gate: EvalGate): string {
  switch (gate.name) {
    case 'minimum_samples': {
      const have = observedNumber(gate.observed) ?? 0;
      const need = observedNumber(gate.threshold);
      return need !== null ? `Add ${Math.max(need - have, 1)} more comparable cases (have ${have}, need ${need}) and re-run the replay.` : 'Add more comparable cases and re-run the replay.';
    }
    case 'quality_floor':
    case 'non_inferiority':
      return 'Give the cases an expected answer (expected_output) so quality can be graded deterministically.';
    case 'protected_slice':
      return 'Mark the cases that must never regress with "protected": true, then re-run.';
    case 'cost_improvement':
      return 'Record a cost for every baseline case (cost_usd), or use a model with known pricing. Unknown cost is never treated as zero.';
    case 'latency_regression':
      return 'Record latency_ms on the baseline cases, or make latency informational for this experiment.';
    case 'fallback':
      return 'Define a fallback in the candidate plan.';
    case 'evidence_completeness':
      return `Re-run the replay so every case has an execution-proven candidate sample${gate.reason ? ` (${gate.reason})` : ''}.`;
    default:
      return gate.reason || `Provide the evidence the ${gate.name} gate needs.`;
  }
}

/** Reasons the evaluator recorded that are more specific than the gate itself. */
function reasonSteps(rejectionReason: string | null): string[] {
  if (!rejectionReason) return [];
  const steps: string[] = [];
  for (const part of rejectionReason.split(';').map((s) => s.trim())) {
    const m = /^(baseline|candidate)_cost_unknown:(\d+)_of_(\d+)_cases$/.exec(part);
    if (m) steps.push(`${m[1] === 'baseline' ? 'Baseline' : 'Candidate'} cost is unknown on ${m[2]} of ${m[3]} cases. ${m[1] === 'baseline' ? 'Re-import those traces with cost_usd.' : 'Use a candidate model with known pricing.'}`);
  }
  return steps;
}

export function explainEvaluation(e: Pick<Evaluation, 'status' | 'gates' | 'rejection_reason'>): VerdictExplanation {
  const gates = e.gates || [];
  const required = gates.filter((g) => g.required);
  const passed = required.filter((g) => g.outcome === 'passed');
  const failed = required.filter((g) => g.outcome === 'failed');
  const missing = required.filter((g) => g.outcome === 'missing');
  const informational = gates.filter((g) => !g.required || g.outcome === 'informational');
  const nextEvidence = e.status === 'INCOMPLETE' ? [...new Set([...reasonSteps(e.rejection_reason), ...missing.map(nextStepFor)])] : [];
  const label = (g: EvalGate) => GATE_LABEL[g.name] || g.name;
  const headline =
    e.status === 'VERIFIED'
      ? `All ${passed.length} required gates passed.`
      : e.status === 'REJECTED'
        ? `Rejected by ${failed.map(label).join(', ') || 'a required gate'}.`
        : e.status === 'INCOMPLETE'
          ? `Not enough evidence to decide: ${missing.map(label).join(', ') || 'required evidence missing'}.`
          : e.rejection_reason || e.status;
  return { status: e.status, passed, failed, missing, informational, nextEvidence, headline };
}

/** Gates in the order a reader needs them: what decided the verdict first. */
export function orderedGates(e: Pick<Evaluation, 'status' | 'gates'>): EvalGate[] {
  const rank = (g: EvalGate) => {
    if (e.status === 'REJECTED' && g.outcome === 'failed') return 0;
    if (e.status === 'INCOMPLETE' && g.outcome === 'missing') return 0;
    if (g.outcome === 'failed' || g.outcome === 'missing') return 1;
    if (g.required) return 2;
    return 3;
  };
  return [...(e.gates || [])].sort((a, b) => rank(a) - rank(b));
}

/** One ledger line per candidate execution: the latest evaluation of it. */
export function canonicalEvaluations(evaluations: Evaluation[]): Evaluation[] {
  const byExecution = new Map<string, Evaluation>();
  for (const e of [...evaluations].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!byExecution.has(e.candidate_execution_id)) byExecution.set(e.candidate_execution_id, e);
  }
  return [...byExecution.values()];
}

export interface LedgerSummary {
  /** A. Measured improvement on the evaluated cases, VERIFIED and execution-proven only. */
  measured: { count: number; savedUsd: number | null; evaluatedCases: number };
  excluded: { rejected: number; incomplete: number; unproven: number };
}

/** Only a VERIFIED, execution-proven evaluation with a known negative cost delta counts. */
export function countsAsMeasuredSaving(e: Evaluation) {
  return e.status === 'VERIFIED' && e.execution_proven && typeof e.raw_cost_delta_usd === 'number' && e.raw_cost_delta_usd < 0;
}

export function ledgerSummary(evaluations: Evaluation[]): LedgerSummary {
  const rows = canonicalEvaluations(evaluations);
  const counted = rows.filter(countsAsMeasuredSaving);
  return {
    measured: {
      count: counted.length,
      savedUsd: counted.length ? counted.reduce((a, e) => a + -(e.raw_cost_delta_usd as number), 0) : null,
      evaluatedCases: counted.reduce((a, e) => a + e.sample_count, 0),
    },
    excluded: {
      rejected: rows.filter((e) => e.status === 'REJECTED').length,
      incomplete: rows.filter((e) => e.status === 'INCOMPLETE' || e.status === 'NEEDS_EVIDENCE').length,
      unproven: rows.filter((e) => e.status === 'VERIFIED' && !e.execution_proven).length,
    },
  };
}

function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? 'unknown' : `$${Number(v).toFixed(6)}`;
}
function fmtVal(v: unknown) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Number(v.toFixed(4)));
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
const cell = (v: unknown) => fmtVal(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export interface ReportContext {
  productName: string;
  evaluation: Evaluation;
  strategy: string | null;
  candidateModel: string | null;
  costSource: string | null;
  generatedAt?: string;
}

/**
 * A plain-Markdown evidence report a reviewer can read without the app. It
 * states what was measured, on how many cases, and what it does not claim.
 */
export function evidenceReportMarkdown(ctx: ReportContext): string {
  const e = ctx.evaluation;
  const x = explainEvaluation(e);
  const counted = countsAsMeasuredSaving(e);
  const lines: string[] = [];
  lines.push(`# ZEVQORA evidence report — ${ctx.productName}`);
  lines.push('');
  lines.push(`Generated ${ctx.generatedAt || new Date().toISOString()} · evaluation \`${e.id}\``);
  lines.push('');
  lines.push(`## Verdict: ${e.status}`);
  lines.push('');
  lines.push(x.headline);
  if (e.status === 'REJECTED' && e.rejection_reason) lines.push('', `Reason: ${e.rejection_reason}`);
  if (x.nextEvidence.length) {
    lines.push('', '### Evidence still required', '');
    for (const s of x.nextEvidence) lines.push(`- ${s}`);
  }
  lines.push('', '## What was compared', '');
  lines.push('| | Value |', '| --- | --- |');
  lines.push(`| Strategy | ${cell(ctx.strategy)} |`);
  lines.push(`| Candidate | ${cell(ctx.candidateModel)} |`);
  lines.push(`| Evaluated cases | ${e.sample_count} (${e.protected_sample_count} protected) |`);
  lines.push(`| Baseline cost (evaluated cases) | ${fmtUsd(e.baseline_cost_usd)} |`);
  lines.push(`| Candidate cost (evaluated cases) | ${fmtUsd(e.candidate_cost_usd)} |`);
  lines.push(`| Candidate cost source | ${cell(ctx.costSource)} |`);
  lines.push(`| Quality baseline → candidate | ${fmtVal(e.baseline_quality)} → ${fmtVal(e.candidate_quality)} |`);
  lines.push(`| Latency baseline → candidate (ms) | ${fmtVal(e.baseline_latency_ms)} → ${fmtVal(e.candidate_latency_ms)} |`);
  lines.push(`| Execution proven | ${e.execution_proven ? 'yes' : 'no'} |`);
  lines.push(`| Gate config hash | \`${e.gate_config_hash || '—'}\` |`);
  lines.push(`| Grader config hash | \`${e.grader_config_hash || '—'}\` |`);
  lines.push('', '## Gates', '', '| Gate | Required | Outcome | Observed | Threshold | Reason |', '| --- | --- | --- | --- | --- | --- |');
  for (const g of orderedGates(e)) lines.push(`| ${GATE_LABEL[g.name] || g.name} | ${g.required ? 'yes' : 'no'} | ${g.outcome} | ${cell(g.observed)} | ${cell(g.threshold)} | ${cell(g.reason)} |`);
  lines.push('', '## What this report claims', '');
  lines.push(counted
    ? `- **Measured:** ${fmtUsd(-(e.raw_cost_delta_usd as number))} lower cost on these ${e.sample_count} evaluated cases, under the gates above. A point estimate; no confidence interval was computed.`
    : `- **Measured:** no saving. ${e.status === 'VERIFIED' ? 'The cost change is unknown or not a reduction, or execution is not proven.' : `A ${e.status} result is never counted as savings.`}`);
  lines.push('- **Projected production impact:** not modelled. Nothing here scales to production volume.');
  lines.push('- **Realized outcome:** unknown until traces from after the change ships are evaluated.');
  lines.push('', 'Deterministic graders; no model judged another model. A person decides whether this change ships.');
  return lines.join('\n') + '\n';
}

// ---- which findings the engine can actually test ---------------------------------

export type SupportedStrategy = 'exact_reuse' | 'model_substitution';

interface CategoryInfo {
  family: string;
  strategy: SupportedStrategy | null;
  tradeoff: string;
}

/**
 * Finding category -> the strategy the engine can run for it today. Categories
 * without a strategy are signals: worth reading, never testable as a candidate.
 */
const CATEGORY: Record<string, CategoryInfo> = {
  repeated_execution: { family: 'Exact reuse', strategy: 'exact_reuse', tradeoff: 'Only identical requests are reused; answers stay byte-identical, freshness depends on how long results are kept.' },
  duplicate_work: { family: 'Exact reuse', strategy: 'exact_reuse', tradeoff: 'Only identical requests are reused; answers stay byte-identical, freshness depends on how long results are kept.' },
  cache_candidate: { family: 'Exact reuse', strategy: 'exact_reuse', tradeoff: 'Only identical requests are reused; answers stay byte-identical, freshness depends on how long results are kept.' },
  structured_task_candidate: { family: 'Model substitution', strategy: 'model_substitution', tradeoff: 'A cheaper model on a bounded task; quality must hold on graded cases.' },
  structured_output_candidate: { family: 'Model substitution', strategy: 'model_substitution', tradeoff: 'A cheaper model on a structured-output task; format and quality must hold on graded cases.' },
  expensive_model_simple_task: { family: 'Model substitution', strategy: 'model_substitution', tradeoff: 'A cheaper model on a simple task; quality must hold on graded cases.' },
  cost_concentration: { family: 'Model substitution', strategy: 'model_substitution', tradeoff: 'Where most of the cost is; test a cheaper model here first.' },
  context_review: { family: 'Context review', strategy: null, tradeoff: 'Signal only: context reduction is not a supported strategy yet.' },
  context_bloat: { family: 'Context review', strategy: null, tradeoff: 'Signal only: context reduction is not a supported strategy yet.' },
  reliability_retries: { family: 'Reliability', strategy: null, tradeoff: 'Signal only: retry policy changes are not a supported strategy yet.' },
  retry_storm: { family: 'Reliability', strategy: null, tradeoff: 'Signal only: retry policy changes are not a supported strategy yet.' },
  routing_candidate: { family: 'Routing', strategy: null, tradeoff: 'Signal only: bounded routing runs on the desktop engine, not on the platform yet.' },
};

export interface CandidateState {
  family: string;
  strategy: SupportedStrategy | null;
  executable: boolean;
  /** Why it cannot be tested yet, when it cannot. */
  blocker: string | null;
  tradeoff: string;
}

export function candidateFor(finding: { category: string; origin: string }, traceCount: number): CandidateState {
  const info = CATEGORY[finding.category] || { family: 'Signal', strategy: null, tradeoff: 'No supported strategy for this signal yet.' };
  const blocker = !info.strategy ? 'No supported strategy' : traceCount === 0 ? 'Needs execution traces' : null;
  return { family: info.family, strategy: info.strategy, executable: !blocker, blocker, tradeoff: info.tradeoff };
}

export function firstSupported<T extends { category: string; origin: string; confidence: number }>(findings: T[], traceCount: number): T | null {
  return [...findings].filter((f) => candidateFor(f, traceCount).strategy).sort((a, b) => b.confidence - a.confidence)[0] || null;
}
