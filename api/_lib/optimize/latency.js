/**
 * Latency / critical-path analysis over ZevIR graphs. Bounded and
 * deterministic; no graph framework.
 *
 * Per graph: follow the call structure (CALLS / RETRIEVES edges) from the
 * Task and compute the critical path with the standard trace algorithm —
 * walk back from the parent's end, take the child that ends last, move the
 * cursor to its start, repeat; the gaps are the parent's own time. Children
 * that overlap an already-chosen child run in parallel and are off the path.
 *
 * The analysis is INCOMPLETE (no path is invented) when the call structure
 * has a cycle, when a node on the path has no start/end timestamps, or when
 * the root's duration is unknown. Engine graphs carry a model-call latency
 * but no request timing, so for them only per-node observed latency is
 * reported and the share of root latency stays unknown.
 */
import { percentile } from './performance.js';

export const LATENCY_VERSION = 'latency_v0.1';
const STRUCTURE = new Set(['CALLS', 'RETRIEVES']);
const MAX_DEPTH = 64;

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const timed = (n) => Number.isFinite(ms(n.started_at)) && Number.isFinite(ms(n.ended_at)) && ms(n.ended_at) >= ms(n.started_at);
const observedMs = (n) => (n.duration_ms !== null && n.duration_ms !== undefined ? Number(n.duration_ms) : n.latency_ms !== null && n.latency_ms !== undefined ? Number(n.latency_ms) : null);
export const nodeClass = (n) => `${n.kind}${n.operation ? `:${n.operation}` : ''}:${n.name || '?'}`;

/** Critical path of one graph. graph = { id, graph_hash, nodes, edges } (persisted rows). */
export function criticalPath(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const children = new Map();
  for (const e of graph.edges) {
    if (!STRUCTURE.has(e.kind)) continue;
    if (!children.has(e.source_node_id)) children.set(e.source_node_id, []);
    children.get(e.source_node_id).push(byId.get(e.target_node_id));
  }
  const root = byId.get(graph.root_node_id) || graph.nodes.find((n) => n.kind === 'Task');
  const missing = [];
  if (!root) return { graph_id: graph.id, status: 'incomplete', missing: ['no Task root'], path: [] };

  // Cycle check over the call structure (agent loops may cycle; a path through a cycle is undefined).
  const state = new Map();
  let cyclic = false;
  const visit = (id, depth) => {
    if (depth > MAX_DEPTH) {
      cyclic = true;
      return;
    }
    state.set(id, 1);
    for (const c of children.get(id) || []) {
      if (!c) continue;
      if (state.get(c.id) === 1) cyclic = true;
      else if (!state.has(c.id)) visit(c.id, depth + 1);
    }
    state.set(id, 2);
  };
  visit(root.id, 0);
  if (cyclic) return { graph_id: graph.id, status: 'incomplete', missing: ['call structure contains a cycle (or exceeds depth 64)'], path: [] };
  if (!timed(root)) missing.push(`root ${root.kind} has no start/end timestamps`);

  const segments = new Map();
  const add = (node, amount) => {
    if (amount > 0) segments.set(node.id, (segments.get(node.id) || 0) + amount);
  };
  const order = [];
  const walk = (node, upTo) => {
    if (!timed(node)) {
      missing.push(`${node.kind} '${node.name || node.stable_key.slice(0, 8)}' on the path has no timestamps`);
      return;
    }
    order.push(node.id);
    const start = ms(node.started_at);
    let cursor = Math.min(ms(node.ended_at), upTo);
    const kids = (children.get(node.id) || []).filter(Boolean);
    const untimed = kids.filter((k) => !timed(k));
    if (untimed.length) missing.push(`${untimed.length} child node(s) of ${node.kind} '${node.name || ''}' have no timestamps`);
    const timedKids = kids.filter(timed).sort((a, b) => ms(b.ended_at) - ms(a.ended_at) || (a.stable_key < b.stable_key ? -1 : 1));
    let chosen = false;
    for (const kid of timedKids) {
      const kidEnd = Math.min(ms(kid.ended_at), cursor);
      // After the first chosen child, a child ending past the cursor overlapped it: parallel, off the path.
      // The first child is clamped to the parent's window instead (clock skew).
      if (chosen && ms(kid.ended_at) > cursor + 0.0001) continue;
      if (kidEnd <= start) continue;
      add(node, cursor - kidEnd);
      walk(kid, kidEnd);
      chosen = true;
      cursor = Math.max(start, ms(kid.started_at));
    }
    add(node, cursor - start);
  };
  if (!missing.length) walk(root, ms(root.ended_at));
  if (missing.length) return { graph_id: graph.id, status: 'incomplete', missing: [...new Set(missing)].slice(0, 10), path: [] };

  const rootMs = ms(root.ended_at) - ms(root.started_at);
  const path = order.map((id) => {
    const n = byId.get(id);
    const self = segments.get(id) || 0;
    return { node_id: id, stable_key: n.stable_key, kind: n.kind, name: n.name, operation: n.operation || null, self_ms: self, total_ms: observedMs(n), share_of_root: rootMs > 0 ? self / rootMs : null };
  });
  return { graph_id: graph.id, graph_hash: graph.graph_hash, status: 'complete', root_duration_ms: rootMs, path, missing: [] };
}

/**
 * Workload hotspots across a graph set: which node classes explain observed
 * latency. Only complete analyses contribute a share of root latency.
 */
export function latencyAnalysis(graphs, { retryLatencyMs = null, retriedRequests = 0 } = {}) {
  const analyses = graphs.map(criticalPath);
  const complete = analyses.filter((a) => a.status === 'complete');
  const classes = new Map();
  const bump = (n) => {
    const k = nodeClass(n);
    if (!classes.has(k)) classes.set(k, { class: k, kind: n.kind, name: n.name, operation: n.operation || null, durations: [], on_path: 0, shares: [], nodes: [] });
    return classes.get(k);
  };
  for (const g of graphs) {
    for (const n of g.nodes) {
      if (n.kind === 'Task' || n.kind === 'Runtime' || n.kind === 'Outcome') continue;
      const d = observedMs(n);
      if (d === null) continue;
      const c = bump(n);
      c.durations.push(d);
      if (c.nodes.length < 20) c.nodes.push({ graph_id: g.id, node_id: n.id, stable_key: n.stable_key });
    }
  }
  for (const a of complete) {
    for (const step of a.path) {
      if (step.kind === 'Task') continue;
      const c = classes.get(`${step.kind}${step.operation ? `:${step.operation}` : ''}:${step.name || '?'}`);
      if (!c) continue;
      c.on_path += 1;
      if (step.share_of_root !== null) c.shares.push(step.share_of_root);
    }
  }
  const hotspots = [...classes.values()]
    .map((c) => ({
      class: c.class,
      kind: c.kind,
      name: c.name,
      operation: c.operation,
      samples: c.durations.length,
      p50_ms: percentile(c.durations, 50),
      p95_ms: percentile(c.durations, 95),
      critical_path_graphs: c.on_path,
      mean_share_of_root: c.shares.length ? c.shares.reduce((a, b) => a + b, 0) / c.shares.length : null,
      nodes: c.nodes,
    }))
    .sort((a, b) => (b.p95_ms ?? -1) - (a.p95_ms ?? -1) || a.class.localeCompare(b.class))
    .slice(0, 10);
  const rootDurations = complete.map((a) => a.root_duration_ms);
  const reasons = [...new Set(analyses.filter((a) => a.status === 'incomplete').flatMap((a) => a.missing))].slice(0, 5);
  return {
    version: LATENCY_VERSION,
    graphs: graphs.length,
    complete: complete.length,
    incomplete: analyses.length - complete.length,
    status: !graphs.length ? 'no_graphs' : complete.length ? (complete.length === analyses.length ? 'complete' : 'partial') : 'incomplete',
    incomplete_reasons: reasons,
    root: { samples: rootDurations.length, p50_ms: percentile(rootDurations, 50), p95_ms: percentile(rootDurations, 95) },
    hotspots,
    retry: retriedRequests ? { retried_requests: retriedRequests, added_latency_ms: retryLatencyMs, mean_added_ms: retryLatencyMs !== null ? retryLatencyMs / retriedRequests : null } : null,
    sample_paths: complete.slice(0, 3).map((a) => ({ graph_id: a.graph_id, root_duration_ms: a.root_duration_ms, path: a.path })),
  };
}
