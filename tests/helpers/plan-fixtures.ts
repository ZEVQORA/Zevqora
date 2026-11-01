/**
 * Pure fixtures for plan-search tests: the synthetic demo traces with stable
 * ids, a pricing snapshot shaped like model_pricing rows, the diagnoses and
 * the pass context the search uses. SYNTHETIC — NOT CUSTOMER DATA.
 */
import { parseTraces } from '../../api/_lib/product/traces.js';
import { demoTraces, DEMO_V2_REQUIREMENTS } from '../../api/_lib/optimize/demo.js';
import { performanceSnapshot } from '../../api/_lib/optimize/performance.js';
import { diagnose } from '../../api/_lib/optimize/diagnose.js';
import { normalizeRequirements } from '../../api/_lib/optimize/contract.js';
import { evaluationSet, generatePlans, normalizeBounds } from '../../api/_lib/optimize/search.js';
import { finalRows } from '../../api/_lib/optimize/passes-intelligence.js';

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const PRICING = new Map<string, Row>([
  ['openai/gpt-4o', { model: 'openai/gpt-4o', provider: 'openai', input_per_million: 2.5, output_per_million: 10, cached_input_per_million: 1.25, tier: 'frontier', retrieved_at: '2026-09-01' }],
  ['openai/gpt-4o-mini', { model: 'openai/gpt-4o-mini', provider: 'openai', input_per_million: 0.15, output_per_million: 0.6, cached_input_per_million: 0.075, tier: 'small', retrieved_at: '2026-09-01' }],
]);
export const CONTRACT_HASH = 'c'.repeat(64);
export const SNAPSHOT_HASH = 'd'.repeat(64);
export const REQUIREMENTS = normalizeRequirements(DEMO_V2_REQUIREMENTS);

export function demoRows(): Row[] {
  const { rows } = parseTraces({ traces: demoTraces() });
  return rows.map((t: Row, i: number) => ({ ...t, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
}

export function context(traces: Row[], { platformCompute = false, graphs = [] as Row[] } = {}) {
  const snapshot = performanceSnapshot(traces, REQUIREMENTS, {});
  const diagnoses = diagnose({ product: { id: 'p' }, snapshot, traces, graphs, latency: { hotspots: [] }, requirements: REQUIREMENTS, pricing: PRICING });
  const ctx = { traces, history: finalRows(traces), pricing: PRICING, allowedModels: new Set(['openai/gpt-4o-mini']), platformCompute, contract: { hash: CONTRACT_HASH, requirements: REQUIREMENTS } };
  return { snapshot, diagnoses, ctx };
}

export function search(traces: Row[], { bounds = {}, platformCompute = false, diagnosesOrder = null as null | ((d: Row[]) => Row[]) } = {}) {
  const { diagnoses, ctx } = context(traces, { platformCompute });
  const evaluation = evaluationSet(traces, { max: 60, seed: 'seed' });
  const ids = new Set(evaluation.ids);
  return {
    ...generatePlans({ diagnoses: diagnosesOrder ? diagnosesOrder(diagnoses) : diagnoses, ctx, bounds: normalizeBounds(bounds), contractHash: CONTRACT_HASH, snapshotHash: SNAPSHOT_HASH, evaluation, rows: traces.filter((t) => ids.has(t.id)) }),
    evaluation,
    diagnoses,
    ctx,
  };
}

// ---- ZevIR graph builder for agent / retrieval structure -----------------------------
let n = 0;
const sha = (s: string) => ({ sha256: s.padEnd(64, '0').slice(0, 64), length: s.length, keys: 1 });
export function agentGraph(steps: Array<{ kind: 'ToolCall' | 'Retrieval' | 'ModelCall'; name: string; input: string; output: string; ms?: number; docs?: string[]; count?: number }>, { agent = 'refund_agent', start = 0 } = {}) {
  n += 1;
  const gid = `g${n}`;
  const nodes: Row[] = [];
  const edges: Row[] = [];
  const id = (k: string) => `${gid}-${k}`;
  let t = Date.UTC(2026, 8, 2) + start;
  nodes.push({ id: id('task'), stable_key: `${gid}task`.padEnd(64, 'a'), kind: 'Task', name: 'task', started_at: new Date(t).toISOString(), ended_at: null, attributes: {} });
  nodes.push({ id: id('agent'), stable_key: `${gid}agent`.padEnd(64, 'b'), kind: 'Agent', name: agent, started_at: new Date(t).toISOString(), attributes: { agent_name: agent } });
  edges.push({ source_node_id: id('task'), target_node_id: id('agent'), kind: 'CALLS', ordinal: 0 });
  steps.forEach((s, i) => {
    const ms = s.ms ?? 100;
    const nid = id(`s${i}`);
    const attributes: Row = s.kind === 'ToolCall' ? { tool_name: s.name, arguments_digest: sha(`a${s.input}`), result_digest: sha(`r${s.output}`) } : s.kind === 'Retrieval' ? { query_digest: sha(`q${s.input}`), documents_digest: sha(`d${s.output}`), document_refs: (s.docs || []).map((d) => ({ id: d })), document_count: s.count ?? (s.docs || []).length } : { input_digest: sha(`m${s.input}`) };
    nodes.push({ id: nid, stable_key: `${gid}s${i}`.padEnd(64, 'c'), kind: s.kind, name: s.name, started_at: new Date(t).toISOString(), ended_at: new Date(t + ms).toISOString(), duration_ms: ms, attributes });
    if (s.kind === 'ModelCall') {
      nodes.push({ id: `${nid}-o`, stable_key: `${gid}o${i}`.padEnd(64, 'd'), kind: 'Outcome', name: 'output', attributes: { output_digest: sha(`o${s.output}`) } });
      edges.push({ source_node_id: nid, target_node_id: `${nid}-o`, kind: 'PRODUCES', ordinal: null });
    }
    edges.push({ source_node_id: id('agent'), target_node_id: nid, kind: s.kind === 'Retrieval' ? 'RETRIEVES' : 'CALLS', ordinal: i });
    t += ms + 10;
  });
  return { id: gid, graph_hash: gid.padEnd(64, 'e'), source_kind: 'openinference', nodes, edges };
}
