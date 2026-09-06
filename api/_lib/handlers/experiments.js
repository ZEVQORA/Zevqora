import { on } from '../router.js';
import { ApiError, json, readJson, num, uuid } from '../http.js';
import { requireUser, requireProjectAccess, rateLimit } from '../auth.js';
import { loadPricing, estimateCost } from '../pricing.js';
import { chatCompletion, openRouterConfigured } from '../openrouter.js';
import { chooseGrader, grade, GRADER_VERSION } from '../engine/graders.js';
import { evaluateGates, GATE_VERSION } from '../engine/gates.js';
import { sha256, canonicalJson } from '../sanitize.js';
import { workspacePlan } from './workspaces.js';

const MIN_SAMPLES = 5;
const MAX_RUNNING_PER_WORKSPACE = 2;
const RUN_DEADLINE_MS = 80_000;
const CONCURRENCY = 4;
const BOUNDED_OUTPUT_TOKENS = 64;
const REPLAYABLE = new Set(['exact_reuse', 'model_substitution', 'bounded_routing']);

function median(values) {
  const arr = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}
const sum = (arr) => arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const r = (v, d = 6) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(d)) : null);

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Deterministic replay of repeated prompts: no provider calls, outputs compared by hash. */
async function runExactReuse({ admin, project, sampleLimit, since }) {
  const { data: events } = await admin
    .from('telemetry_events')
    .select('id,occurred_at,model,prompt_hash,output_hash,cost_usd,latency_ms,status')
    .eq('project_id', project.id)
    .eq('status', 'ok')
    .not('prompt_hash', 'is', null)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(5000);
  const groups = new Map();
  for (const e of events || []) {
    const g = groups.get(e.prompt_hash) || [];
    g.push(e);
    groups.set(e.prompt_hash, g);
  }
  const repeated = [...groups.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length).slice(0, sampleLimit);
  if (!repeated.length) return { needsEvidence: 'No repeated prompts were found in the analysis window. Re-run the analysis after more traffic arrives.' };
  const cases = repeated.map((g, i) => {
    const first = g[0];
    const baselineCost = sum(g.map((e) => (e.cost_usd === null ? NaN : Number(e.cost_usd))));
    const costKnown = g.every((e) => e.cost_usd !== null);
    const candidateCost = first.cost_usd === null ? null : Number(first.cost_usd);
    const hashes = g.map((e) => e.output_hash);
    const hashKnown = hashes.every(Boolean);
    const identical = hashKnown && new Set(hashes).size === 1;
    const baselineLatency = median(g.map((e) => (e.latency_ms === null ? NaN : Number(e.latency_ms))));
    const firstLatency = first.latency_ms === null ? null : Number(first.latency_ms);
    // Cache hits are served locally; a 1 ms cost is assumed per hit for the latency figure.
    const candidateLatency = firstLatency === null ? null : (firstLatency + (g.length - 1) * 1) / g.length;
    return {
      case_index: i,
      telemetry_event_id: first.id,
      grader: 'exact_reuse_identity',
      score: hashKnown ? (identical ? 1 : 0) : null,
      passed: identical,
      baseline_model: first.model,
      candidate_model: 'cache',
      baseline_output_hash: hashes[0] || null,
      candidate_output_hash: hashes[0] || null,
      baseline_cost_usd: costKnown ? r(baselineCost, 8) : null,
      candidate_cost_usd: costKnown ? r(candidateCost, 8) : null,
      baseline_latency_ms: r(baselineLatency, 2),
      candidate_latency_ms: r(candidateLatency, 2),
      details: { repeats: g.length, output_hash_known: hashKnown, identical_outputs: identical, prompt_hash: first.prompt_hash },
      error: hashKnown ? null : 'output_hash missing on one or more repeats',
    };
  });
  return { cases, providerCost: 0, baselineModel: cases[0].baseline_model, candidateModel: 'prompt-hash cache', executionFailures: 0 };
}

/** Replays captured samples through a cheaper model on the platform credential. */
async function runModelReplay({ admin, project, opportunity, sampleLimit, since, pricing, remainingCredit, strategy }) {
  if (!openRouterConfigured()) throw new ApiError(503, 'Cloud replay is not configured on this deployment yet. The platform provider credential (server-side) is missing.', 'PROVIDER_NOT_CONFIGURED');
  const currentModel = opportunity.current_model;
  const candidateModel = strategy === 'bounded_routing' ? opportunity.candidate_config?.cheap_model : opportunity.candidate_config?.candidate_model;
  if (!currentModel || !candidateModel) throw new ApiError(409, 'This opportunity has no candidate model to replay.', 'INVALID_STATE');
  const { data: samples } = await admin
    .from('telemetry_events')
    .select('id,occurred_at,model,input_tokens,output_tokens,cost_usd,latency_ms,sample,output_hash')
    .eq('project_id', project.id)
    .eq('model', currentModel)
    .eq('status', 'ok')
    .eq('has_sample', true)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(sampleLimit);
  const usable = (samples || []).filter((s) => Array.isArray(s.sample?.messages) && s.sample.messages.length && typeof s.sample?.output === 'string' && s.sample.output.length);
  if (usable.length < MIN_SAMPLES) {
    return { needsEvidence: `Replay needs at least ${MIN_SAMPLES} captured samples for ${currentModel}; ${usable.length} available. Enable "capture samples" on the connection so requests and responses are stored (sanitized) for replay.` };
  }

  // Credit pre-check: never start a run the balance cannot cover.
  const estimated = sum(usable.map((s) => estimateCost(pricing, candidateModel, { input: s.input_tokens || 0, output: s.output_tokens || 0 })?.cost ?? 0.002)) * 1.5;
  if (remainingCredit < Math.max(0.01, estimated)) throw new ApiError(402, `This replay needs about $${Math.max(0.01, estimated).toFixed(3)} of Zev credit; $${remainingCredit.toFixed(2)} remains.`, 'INSUFFICIENT_CREDITS');

  const deadline = Date.now() + RUN_DEADLINE_MS;
  const results = await mapLimit(usable, CONCURRENCY, async (s, i) => {
    const baselineOutput = s.sample.output;
    const grader = chooseGrader(baselineOutput);
    const baselineCost = s.cost_usd === null ? estimateCost(pricing, currentModel, { input: s.input_tokens || 0, output: s.output_tokens || 0 })?.cost ?? null : Number(s.cost_usd);
    const baselineLatency = s.latency_ms === null ? null : Number(s.latency_ms);
    const bounded = strategy !== 'bounded_routing' || (typeof s.output_tokens === 'number' && s.output_tokens <= BOUNDED_OUTPUT_TOKENS);
    if (!bounded) {
      // Routing policy keeps this case on the strong (baseline) model. No call is made; baseline evidence is reused.
      return {
        case_index: i, telemetry_event_id: s.id, grader: 'routed_to_baseline', score: 1, passed: true,
        baseline_model: currentModel, candidate_model: currentModel,
        baseline_output_hash: s.output_hash, candidate_output_hash: s.output_hash,
        baseline_cost_usd: r(baselineCost, 8), candidate_cost_usd: r(baselineCost, 8),
        baseline_latency_ms: r(baselineLatency, 2), candidate_latency_ms: r(baselineLatency, 2),
        details: { route: 'strong', reason: `output_tokens ${s.output_tokens} > ${BOUNDED_OUTPUT_TOKENS}` }, error: null, provider_cost: 0,
      };
    }
    if (Date.now() > deadline) {
      return { case_index: i, telemetry_event_id: s.id, grader, score: null, passed: false, baseline_model: currentModel, candidate_model: candidateModel, baseline_output_hash: s.output_hash, candidate_output_hash: null, baseline_cost_usd: r(baselineCost, 8), candidate_cost_usd: null, baseline_latency_ms: r(baselineLatency, 2), candidate_latency_ms: null, details: {}, error: 'run deadline exceeded', provider_cost: 0 };
    }
    try {
      const maxTokens = Math.min(2048, Math.max(64, Math.round((s.output_tokens || 128) * 2 + 64)));
      const responseFormat = s.sample.response_format || (grader === 'json_equivalence' ? { type: 'json_object' } : null);
      const out = await chatCompletion({ model: candidateModel, messages: s.sample.messages, maxTokens, temperature: 0, responseFormat, timeoutMs: 30_000 });
      const g = grade(grader, baselineOutput, out.content);
      const candidateCost = out.cost !== null ? out.cost : estimateCost(pricing, candidateModel, { input: out.inputTokens || 0, output: out.outputTokens || 0, cached: out.cachedInputTokens || 0 })?.cost ?? null;
      return {
        case_index: i, telemetry_event_id: s.id, grader, score: g.score, passed: g.score >= 0.999,
        baseline_model: currentModel, candidate_model: out.model || candidateModel,
        baseline_output_hash: s.output_hash, candidate_output_hash: out.content ? sha256(out.content.trim()) : null,
        baseline_cost_usd: r(baselineCost, 8), candidate_cost_usd: r(candidateCost, 8),
        baseline_latency_ms: r(baselineLatency, 2), candidate_latency_ms: r(out.latencyMs, 2),
        details: { ...g.details, route: 'cheap', candidate_tokens: { input: out.inputTokens, output: out.outputTokens }, cost_source: out.costSource, finish_reason: out.finishReason, candidate_preview: (out.content || '').slice(0, 160), provider_request_id: out.requestId },
        error: null, provider_cost: out.cost || 0,
      };
    } catch (error) {
      return { case_index: i, telemetry_event_id: s.id, grader, score: 0, passed: false, baseline_model: currentModel, candidate_model: candidateModel, baseline_output_hash: s.output_hash, candidate_output_hash: null, baseline_cost_usd: r(baselineCost, 8), candidate_cost_usd: null, baseline_latency_ms: r(baselineLatency, 2), candidate_latency_ms: null, details: {}, error: String(error?.message || 'execution failed').slice(0, 200), provider_cost: 0 };
    }
  });
  const providerCost = sum(results.map((c) => c.provider_cost || 0));
  const executionFailures = results.filter((c) => c.error).length;
  return { cases: results.map(({ provider_cost: _p, ...c }) => c), providerCost, baselineModel: currentModel, candidateModel, executionFailures };
}

on('POST', '/api/opportunities/:id/experiments', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const opportunityId = uuid(params.id, 'opportunity');
  const { data: opportunity } = await admin.from('opportunities').select('*').eq('id', opportunityId).maybeSingle();
  if (!opportunity) throw new ApiError(404, 'Opportunity not found.', 'NOT_FOUND');
  const { project } = await requireProjectAccess(admin, opportunity.project_id, user.id, 'member');
  rateLimit(`experiment:${user.id}`, { limit: 6, windowMs: 60_000 });
  if (opportunity.status === 'testing') throw new ApiError(409, 'An experiment is already running for this opportunity.', 'ALREADY_RUNNING');

  const body = await readJson(request);
  const { planId, plan } = await workspacePlan(admin, project.workspace_id);
  const planSamples = Number(plan.limits?.replay_samples) || 8;
  const sampleLimit = Math.min(planSamples, num(body?.sample_size, { name: 'Sample size', min: MIN_SAMPLES, max: 200, integer: true }) ?? planSamples);
  const qualityGate = num(body?.quality_gate, { name: 'Quality gate', min: 0.5, max: 1 }) ?? Number(project.settings?.quality_gate ?? 0.95);
  const maxLatencyRegression = Number(project.settings?.max_latency_regression_pct ?? 50);

  const { data: flag } = await admin.from('feature_flags').select('enabled,plan_overrides').eq('key', 'cloud_replay').maybeSingle();
  const replayEnabled = flag ? (typeof flag.plan_overrides?.[planId] === 'boolean' ? flag.plan_overrides[planId] : flag.enabled) : true;

  const { count: running } = await admin.from('experiments').select('id', { count: 'exact', head: true }).eq('workspace_id', project.workspace_id).eq('status', 'running').gte('started_at', new Date(Date.now() - 5 * 60_000).toISOString());
  if ((running || 0) >= MAX_RUNNING_PER_WORKSPACE) throw new ApiError(429, 'Two experiments are already running in this workspace. Wait for one to finish.', 'CONCURRENCY_LIMIT');

  const { data: ws } = await admin.from('workspaces').select('owner_id').eq('id', project.workspace_id).single();
  const { data: credit } = await admin.from('credit_balances').select('included_usd,used_usd').eq('user_id', ws.owner_id).maybeSingle();
  const remainingCredit = Number(credit?.included_usd ?? 5) - Number(credit?.used_usd ?? 0);

  const strategy = opportunity.candidate_strategy;
  const requestId = crypto.randomUUID();
  const { data: experiment, error: insertError } = await admin
    .from('experiments')
    .insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      opportunity_id: opportunity.id,
      request_id: requestId,
      status: 'running',
      strategy,
      quality_gate: qualityGate,
      baseline: { provider: opportunity.current_provider, model: opportunity.current_model },
      candidate: { strategy, ...opportunity.candidate_config },
      created_by: user.id,
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (insertError) throw insertError;
  await admin.from('opportunities').update({ status: 'testing' }).eq('id', opportunity.id);

  const finish = async (patch, opportunityStatus) => {
    const { data } = await admin.from('experiments').update({ ...patch, completed_at: new Date().toISOString() }).eq('id', experiment.id).select('*').single();
    await admin.from('opportunities').update({ status: opportunityStatus }).eq('id', opportunity.id);
    return data;
  };

  try {
    if (!REPLAYABLE.has(strategy)) {
      const reason =
        strategy === 'context_reduction'
          ? 'Context reduction changes how prompts are built, which is a code-level change. Replay it with the ZEVQORA desktop engine against the repository, or instrument a candidate route and send its telemetry to compare.'
          : strategy === 'retry_policy'
            ? 'Retry and fallback policy changes are measured after deployment. Ship the policy behind a flag, then compare the telemetry windows here.'
            : 'This candidate strategy needs a code-level change and cannot be replayed on the platform alone.';
      const done = await finish({ status: 'needs_evidence', error: reason, gates: [], evidence: { reason, gate_version: GATE_VERSION } }, 'needs_evidence');
      return json({ experiment: done, cases: [] }, 200);
    }
    if (!replayEnabled) throw new ApiError(503, 'Cloud replay is disabled for this plan or deployment.', 'FEATURE_DISABLED');

    const pricing = await loadPricing(admin);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const run =
      strategy === 'exact_reuse'
        ? await runExactReuse({ admin, project, sampleLimit, since })
        : await runModelReplay({ admin, project, opportunity, sampleLimit, since, pricing, remainingCredit, strategy });

    if (run.needsEvidence) {
      const done = await finish({ status: 'needs_evidence', error: run.needsEvidence, gates: [], evidence: { reason: run.needsEvidence, gate_version: GATE_VERSION } }, 'needs_evidence');
      return json({ experiment: done, cases: [] }, 200);
    }

    const cases = run.cases;
    const scores = cases.map((c) => c.score).filter((v) => typeof v === 'number');
    const qualityScore = scores.length === cases.length && cases.length ? sum(scores) / cases.length : null;
    const baselineCosts = cases.map((c) => c.baseline_cost_usd);
    const candidateCosts = cases.map((c) => c.candidate_cost_usd);
    const costComplete = baselineCosts.every((v) => typeof v === 'number') && candidateCosts.every((v) => typeof v === 'number');
    const baselineCost = costComplete ? sum(baselineCosts) : null;
    const candidateCost = costComplete ? sum(candidateCosts) : null;
    const baselineLatency = median(cases.map((c) => c.baseline_latency_ms));
    const candidateLatency = median(cases.map((c) => c.candidate_latency_ms));
    const evidenceComplete = costComplete && cases.every((c) => c.baseline_output_hash) && (strategy !== 'exact_reuse' || cases.every((c) => c.details?.output_hash_known));

    const verdict = evaluateGates({
      sampleSize: cases.length,
      minSamples: MIN_SAMPLES,
      executionFailures: run.executionFailures,
      qualityScore,
      qualityGate,
      baselineCost,
      candidateCost,
      baselineLatency,
      candidateLatency,
      maxLatencyRegressionPct: maxLatencyRegression,
      evidenceComplete,
    });

    const savingsUsd = verdict.passed && baselineCost !== null ? baselineCost - candidateCost : null;
    const savingsPct = verdict.passed && baselineCost ? ((baselineCost - candidateCost) / baselineCost) * 100 : null;
    let projectedMonthly = null;
    if (verdict.passed && savingsPct !== null) {
      const { data: rollup } = await admin.rpc('telemetry_rollup', { p_projects: [project.id], p_since: since });
      const modelSpend = (rollup || []).filter((x) => !run.baselineModel || x.model === run.baselineModel).reduce((a, x) => a + Number(x.cost_usd), 0);
      projectedMonthly = (modelSpend * savingsPct) / 100;
    }

    // Charge exactly what the provider charged, once, keyed on the experiment.
    let charged = 0;
    if (run.providerCost > 0) {
      const { error: creditError } = await admin.rpc('consume_credits', {
        p_user: ws.owner_id, p_workspace: project.workspace_id, p_project: project.id, p_operation: 'experiment', p_amount: Number(run.providerCost.toFixed(6)), p_request_id: `experiment:${experiment.id}`,
        p_metadata: { experiment_id: experiment.id, provider: 'openrouter', model: run.candidateModel, samples: cases.length },
      });
      if (creditError && !/INSUFFICIENT_CREDITS/.test(creditError.message || '')) throw creditError;
      charged = Number(run.providerCost.toFixed(6));
    }

    const caseRows = cases.map((c) => ({ ...c, experiment_id: experiment.id }));
    if (caseRows.length) {
      const { error: caseError } = await admin.from('evaluation_cases').insert(caseRows);
      if (caseError) throw caseError;
    }
    const evidence = {
      gate_version: GATE_VERSION,
      grader_version: GRADER_VERSION,
      graders: [...new Set(cases.map((c) => c.grader))],
      provider: strategy === 'exact_reuse' ? 'none (deterministic replay)' : 'openrouter',
      baseline_model: run.baselineModel,
      candidate_model: run.candidateModel,
      sample_window_start: since,
      sample_ids: cases.map((c) => c.telemetry_event_id),
      quality_gate: qualityGate,
      max_latency_regression_pct: maxLatencyRegression,
      pricing_version: [...new Set(cases.map((c) => c.details?.cost_source).filter(Boolean))],
      rejection_reason: verdict.rejectionReason,
      limitations: [
        'Replay measures the candidate on captured samples, not on live traffic.',
        'Candidate latency is measured from the ZEVQORA platform, baseline latency from your runtime.',
        'Projected monthly savings apply the measured savings percentage to the last 30 days of spend on the baseline model.',
      ],
    };
    const evidenceHash = sha256(canonicalJson({ cases: cases.map((c) => ({ i: c.case_index, b: c.baseline_output_hash, c: c.candidate_output_hash, s: c.score, bc: c.baseline_cost_usd, cc: c.candidate_cost_usd })), gates: verdict.gates, evidence }));
    const done = await finish(
      {
        status: verdict.passed ? 'passed' : 'failed',
        quality_score: r(qualityScore, 4),
        gates: verdict.gates,
        sample_size: cases.length,
        verified_savings_usd: r(savingsUsd, 6),
        verified_savings_pct: r(savingsPct, 2),
        projected_monthly_savings_usd: r(projectedMonthly, 4),
        provider_cost_usd: r(run.providerCost, 8) ?? 0,
        credits_usd: charged,
        baseline: { provider: opportunity.current_provider, model: run.baselineModel, cost_usd: r(baselineCost, 8), latency_p50_ms: r(baselineLatency, 2), quality: strategy === 'exact_reuse' ? 1 : 1, samples: cases.length },
        candidate: { strategy, ...opportunity.candidate_config, model: run.candidateModel, cost_usd: r(candidateCost, 8), latency_p50_ms: r(candidateLatency, 2), quality: r(qualityScore, 4), samples: cases.length },
        evidence,
        evidence_hash: evidenceHash,
        error: verdict.passed ? null : verdict.rejectionReason,
      },
      verdict.passed ? 'verified' : 'rejected',
    );
    return json({ experiment: done, cases: caseRows }, 200);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'The experiment could not be completed.';
    await finish({ status: 'error', error: message, evidence: { gate_version: GATE_VERSION } }, 'open');
    throw error;
  }
});

async function loadReport(admin, user, experimentId) {
  const { data: experiment } = await admin.from('experiments').select('*').eq('id', experimentId).maybeSingle();
  if (!experiment) throw new ApiError(404, 'Experiment not found.', 'NOT_FOUND');
  const { project } = await requireProjectAccess(admin, experiment.project_id, user.id, 'viewer');
  const [{ data: cases }, { data: opportunity }, { data: workspace }] = await Promise.all([
    admin.from('evaluation_cases').select('*').eq('experiment_id', experimentId).order('case_index'),
    experiment.opportunity_id ? admin.from('opportunities').select('id,title,category,issue,root_cause,source_ref,candidate_strategy').eq('id', experiment.opportunity_id).maybeSingle() : { data: null },
    admin.from('workspaces').select('id,name,slug').eq('id', experiment.workspace_id).single(),
  ]);
  return { experiment, project, cases: cases || [], opportunity, workspace };
}

on('GET', '/api/experiments/:id/report', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { experiment, project, cases, opportunity, workspace } = await loadReport(admin, user, uuid(params.id, 'experiment'));
  return {
    report_version: 'report_v1',
    generated_at: new Date().toISOString(),
    workspace: { id: workspace.id, name: workspace.name },
    project: { id: project.id, name: project.name },
    opportunity,
    experiment: {
      id: experiment.id,
      status: experiment.status,
      strategy: experiment.strategy,
      evaluated_at: experiment.completed_at,
      baseline: experiment.baseline,
      candidate: experiment.candidate,
      quality_threshold: experiment.quality_gate,
      quality_score: experiment.quality_score,
      gates: experiment.gates,
      verification_status: experiment.status === 'passed' ? 'VERIFIED' : experiment.status === 'failed' ? 'REJECTED' : experiment.status.toUpperCase(),
      verified_savings_usd: experiment.verified_savings_usd,
      verified_savings_pct: experiment.verified_savings_pct,
      projected_monthly_savings_usd: experiment.projected_monthly_savings_usd,
      sample_size: experiment.sample_size,
      provider_cost_usd: experiment.provider_cost_usd,
      evidence: experiment.evidence,
      evidence_hash: experiment.evidence_hash,
      error: experiment.error,
      created_at: experiment.created_at,
    },
    cases: cases.map((c) => ({ ...c, details: { ...c.details, candidate_preview: undefined } })),
    limitations: experiment.evidence?.limitations || [],
    source: 'ZEVQORA platform replay',
  };
});

on('GET', '/api/experiments/:id/report.csv', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { experiment, cases } = await loadReport(admin, user, uuid(params.id, 'experiment'));
  const header = ['case_index', 'grader', 'score', 'passed', 'baseline_model', 'candidate_model', 'baseline_cost_usd', 'candidate_cost_usd', 'baseline_latency_ms', 'candidate_latency_ms', 'baseline_output_hash', 'candidate_output_hash', 'error'];
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [header.join(','), ...cases.map((c) => header.map((h) => esc(c[h])).join(','))];
  return new Response(lines.join('\n'), {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="zevqora-experiment-${experiment.id.slice(0, 8)}.csv"`, 'cache-control': 'no-store' },
  });
});
