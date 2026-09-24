/**
 * Deterministic fixture for rendering the product views in tests. Every value
 * is invented and labelled as such; nothing here is measured data.
 */
import type { EvalGate, Evaluation, Economics, OptimizationExecution, OptimizationPlan, Product } from '../../src/product/types';

const g = (name: string, outcome: string, extra: Partial<EvalGate> = {}): EvalGate => ({ name, required: true, outcome, observed: null, threshold: null, reason: '', ...extra });

export const FIXTURE_PRODUCT: Product = { id: 'prod-1', name: 'support-assistant (fixture)', root_path: 'browser://support-assistant', monitoring_enabled: false, created_at: '2026-09-01T00:00:00Z', last_scan_at: '2026-09-20T00:00:00Z', source: 'browser', files_scanned: 120, skipped_sensitive_paths: 3 };

function evaluation(over: Partial<Evaluation>): Evaluation {
  return {
    id: 'ev', product_id: FIXTURE_PRODUCT.id, candidate_plan_id: 'plan-sub', candidate_execution_id: 'ex', finding_id: null, status: 'VERIFIED', evaluation_version: 'evals_v1',
    sample_count: 12, protected_sample_count: 2, baseline_quality: 1, candidate_quality: 1, quality_delta: 0, baseline_cost_usd: 0.036, candidate_cost_usd: 0.012,
    raw_cost_delta_usd: -0.024, raw_cost_delta_percent: 66.67, baseline_latency_ms: 900, candidate_latency_ms: 400, evidence_completeness: true,
    verification_source: 'EXECUTION_EVALUATION', execution_proven: true, evidence_version: 'v1', gates: [], rejection_reason: null,
    grader_config_hash: 'a'.repeat(64), gate_config_hash: 'b'.repeat(64), created_at: '2026-09-22T00:00:00Z', completed_at: '2026-09-22T00:00:05Z', note: '', ...over,
  };
}

export const VERIFIED = evaluation({
  id: 'ev-verified', candidate_execution_id: 'ex-verified',
  gates: [g('evidence_completeness', 'passed'), g('minimum_samples', 'passed', { observed: 12, threshold: 5 }), g('quality_floor', 'passed', { observed: 1, threshold: 0.95 }), g('cost_improvement', 'passed')],
});

export const REJECTED_CHEAPER = evaluation({
  id: 'ev-rejected', candidate_execution_id: 'ex-rejected', status: 'REJECTED', candidate_quality: 0.83, raw_cost_delta_usd: -0.03, raw_cost_delta_percent: 83.3, candidate_cost_usd: 0.006,
  rejection_reason: 'quality_floor', created_at: '2026-09-23T00:00:00Z',
  gates: [g('cost_improvement', 'passed'), g('quality_floor', 'failed', { observed: 0.83, threshold: 0.95, reason: 'candidate_quality=0.83; floor=0.95.' })],
});

export const INCOMPLETE = evaluation({
  id: 'ev-incomplete', candidate_execution_id: 'ex-incomplete', status: 'INCOMPLETE', raw_cost_delta_usd: null, raw_cost_delta_percent: null, baseline_cost_usd: null,
  rejection_reason: 'baseline_cost_unknown:4_of_12_cases', created_at: '2026-09-24T00:00:00Z',
  gates: [g('quality_floor', 'passed', { observed: 1, threshold: 0.95 }), g('cost_improvement', 'missing', { reason: 'Cost evidence missing on one or both sides (unknown != 0).' })],
});

export const PLAN: OptimizationPlan = {
  id: 'plan-sub', product_id: FIXTURE_PRODUCT.id, finding_id: null, strategy: 'model_substitution', status: 'READY', reason: '', expected_mechanism: '', risk: 'low', fallback: 'baseline model',
  max_budget_usd: 0.5, sample_scope: [], baseline_config: { model: 'openai/gpt-4o' }, candidate_config: { model: 'openai/gpt-4o-mini' }, required_evidence: [], plan_version: 'v1', config_hash: 'c', blocked_reason: null, created_at: '2026-09-21T00:00:00Z',
};

export function execution(id: string): OptimizationExecution {
  return {
    id, candidate_plan_id: PLAN.id, product_id: FIXTURE_PRODUCT.id, status: 'SUCCEEDED', execution_key: id, attempt: 1, provider: 'openrouter', requested_model: 'openai/gpt-4o-mini', resolved_model: 'openai/gpt-4o-mini',
    started_at: null, completed_at: null, baseline_trace_ids: [], sample_results: [], input_tokens: 400, output_tokens: 20, cached_input_tokens: 0, cost_usd: 0.012, cost_source: 'provider_reported',
    pricing_version: null, latency_ms: 400, provider_request_id: null, provider_call_count: 12, candidate_cost_delta_usd: null, error_category: null, error_detail: null, fallback_used: false, provenance_hash: 'p', created_at: '2026-09-22T00:00:00Z', note: '',
  };
}

export const ECONOMICS_PARTIAL: Economics = {
  trace_count: 12, observed_cost_usd: 0.024, avg_cost_per_trace_usd: 0.003, avg_latency_ms: 900, first_evidence_at: '2026-09-18T00:00:00Z', latest_evidence_at: '2026-09-20T00:00:00Z',
  providers: { openai: 12 }, verified_savings_usd: 0.024, verified_experiments: 1, note: '',
  baseline: {
    trace_count: 12, cost: { known: 8, unknown: 4, complete: false, sources: { imported_external: 8 } }, latency: { known: 12, unknown: 0 }, tokens: { known: 12, input: 480, output: 24 },
    models: { 'openai/gpt-4o': 12 }, workflows: { support: 12 }, evaluation_coverage: { with_expected_output: 12, with_recorded_prompt: 12, protected: 2 }, stale: false, stale_after_days: 30,
    gaps: ['cost_unknown: 4 of 12 traces have no cost; the cost total is a lower bound'],
  },
};

export function fixtureStore(over: Record<string, unknown> = {}) {
  const noop = async () => undefined;
  return {
    engine: {}, runtime: 'browser', canEdit: true, inspect: null, setInspect: () => undefined, health: { status: 'ok', version: 'fixture', provider_mode: 'platform' }, engineError: '', platformStatus: null,
    refreshHealth: noop, products: [FIXTURE_PRODUCT], productsLoading: false, selected: FIXTURE_PRODUCT, selectProduct: () => undefined, scan: null, aiCalls: [], findings: [],
    economics: ECONOMICS_PARTIAL, experiments: [], implementations: [], plans: [PLAN],
    executions: [execution('ex-verified'), execution('ex-rejected'), execution('ex-incomplete')],
    evaluations: [INCOMPLETE, REJECTED_CHEAPER, VERIFIED], dataLoading: false, refreshProducts: noop, refreshProductData: noop, connectRepository: async () => null, runScan: async () => null,
    toggleMonitoring: noop, importTraceFile: noop, archiveProduct: noop, readRepositoryFile: async () => null, ensureRepository: async () => null, pickedRepository: null,
    zevState: 'idle', setZevState: () => undefined, model: 'openai/gpt-4o-mini', setModel: () => undefined,
    ...over,
  };
}
