/**
 * ZevIR Graph Explorer — pure graph model (no React).
 *
 * Graphs are not assumed to be DAGs: back edges (loops, agent retries) are
 * detected with a DFS and drawn as loops, and only the remaining DAG decides
 * the layered layout. Overlays read measured fields only; a missing value is
 * "unknown", never zero. The critical path is computed only when every node on
 * it has a start time and a duration — otherwise the reason is returned.
 */
import type { ZevirEdge, ZevirNode } from '../types';

export type Overlay = 'none' | 'cost' | 'latency' | 'reliability' | 'retries' | 'tokens' | 'security' | 'critical';

export const NODE_KINDS = ['Task', 'Agent', 'Function', 'ModelCall', 'ToolCall', 'Retrieval', 'Runtime', 'Outcome'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const NODE_W = 216;
export const NODE_H = 66;
const GAP_X = 72;
const GAP_Y = 22;

export type GNode = ZevirNode & { ended_at?: string | null; trust_class?: string | null; data_sensitivity?: string | null; action_risk?: string | null; task_success?: boolean | null };
export type GEdge = ZevirEdge & { attributes?: Record<string, unknown> };

/** Edges that close a cycle (target is on the current DFS stack), including self-loops. */
export function backEdges(nodes: GNode[], edges: GEdge[]): Set<string> {
  const out = new Map<string, GEdge[]>();
  for (const e of edges) (out.get(e.source_node_id) || out.set(e.source_node_id, []).get(e.source_node_id)!).push(e);
  for (const list of out.values()) list.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0) || a.target_node_id.localeCompare(b.target_node_id));
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const indeg = new Map<string, number>();
  for (const e of edges) indeg.set(e.target_node_id, (indeg.get(e.target_node_id) || 0) + 1);
  // Roots first (no incoming edges), then everything else so disconnected cycles are covered.
  const order = [...nodes].sort((a, b) => (indeg.get(a.id) ? 1 : 0) - (indeg.get(b.id) ? 1 : 0) || a.id.localeCompare(b.id));
  for (const start of order) {
    if (state.get(start.id)) continue;
    const stack: Array<{ id: string; i: number }> = [{ id: start.id, i: 0 }];
    state.set(start.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = out.get(top.id) || [];
      if (top.i >= list.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const e = list[top.i++];
      const s = state.get(e.target_node_id) || 0;
      if (s === 1) back.add(e.id);
      else if (s === 0) {
        state.set(e.target_node_id, 1);
        stack.push({ id: e.target_node_id, i: 0 });
      }
    }
  }
  return back;
}

const KIND_RANK: Record<string, number> = Object.fromEntries(NODE_KINDS.map((k, i) => [k, i]));

/** Longest-path layering on the DAG part, then a stable order inside each layer. */
export function layout(nodes: GNode[], edges: GEdge[], back = backEdges(nodes, edges)) {
  const ids = new Set(nodes.map((n) => n.id));
  const dag = edges.filter((e) => !back.has(e.id) && ids.has(e.source_node_id) && ids.has(e.target_node_id) && e.source_node_id !== e.target_node_id);
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  for (const e of dag) {
    indeg.set(e.target_node_id, (indeg.get(e.target_node_id) || 0) + 1);
    (out.get(e.source_node_id) || out.set(e.source_node_id, []).get(e.source_node_id)!).push(e.target_node_id);
  }
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const remaining = new Map(indeg);
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of out.get(id) || []) {
      layer.set(t, Math.max(layer.get(t) || 0, (layer.get(id) || 0) + 1));
      remaining.set(t, (remaining.get(t) || 0) - 1);
      if (!remaining.get(t)) queue.push(t);
    }
  }
  const byLayer = new Map<number, GNode[]>();
  for (const n of nodes) (byLayer.get(layer.get(n.id)!) || byLayer.set(layer.get(n.id)!, []).get(layer.get(n.id)!)!).push(n);
  const tallest = Math.max(1, ...[...byLayer.values()].map((l) => l.length));
  const positions = new Map<string, { x: number; y: number; layer: number }>();
  for (const [l, list] of byLayer) {
    list.sort((a, b) => (a.started_at || '').localeCompare(b.started_at || '') || (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || (a.name || '').localeCompare(b.name || '') || a.id.localeCompare(b.id));
    const offset = ((tallest - list.length) * (NODE_H + GAP_Y)) / 2;
    list.forEach((n, i) => positions.set(n.id, { x: l * (NODE_W + GAP_X), y: offset + i * (NODE_H + GAP_Y), layer: l }));
  }
  return { positions, back, layers: byLayer.size };
}

export function nodeLatency(n: GNode) {
  return typeof n.duration_ms === 'number' ? n.duration_ms : typeof n.latency_ms === 'number' ? n.latency_ms : null;
}

export function nodeTokens(n: GNode) {
  const parts = [n.input_tokens, n.output_tokens].filter((v): v is number => typeof v === 'number');
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

export function isRetry(n: GNode) {
  const a = n.attributes || {};
  return (typeof a.attempt === 'number' && a.attempt > 1) || (typeof a.retry_reason === 'string' && a.retry_reason.length > 0);
}

const BAD = /error|fail|timeout|cancel/i;
export function reliability(n: GNode): 'ok' | 'failed' | 'unknown' {
  if (!n.status) return 'unknown';
  return BAD.test(n.status) ? 'failed' : 'ok';
}

export function securityLabel(n: GNode) {
  const parts = [n.data_sensitivity && `data ${n.data_sensitivity}`, n.action_risk && `action ${n.action_risk}`, n.trust_class && `trust ${n.trust_class}`].filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : null;
}

/** 0–4 intensity relative to the largest known value; null = unknown. */
export function intensity(value: number | null, max: number) {
  if (value === null || !Number.isFinite(value)) return null;
  if (max <= 0) return 0;
  return Math.min(4, Math.round(Math.sqrt(value / max) * 4));
}

export interface OverlayValue {
  level: number | null;
  label: string;
  flag?: 'bad' | 'warn' | 'good';
}

export function overlayValue(n: GNode, overlay: Overlay, ctx: { maxCost: number; maxLatency: number; maxTokens: number; critical: Set<string> }): OverlayValue | null {
  switch (overlay) {
    case 'cost':
      if (n.kind !== 'ModelCall' && n.cost_usd === null) return null;
      return { level: intensity(n.cost_usd, ctx.maxCost), label: n.cost_usd === null ? 'cost unknown' : `$${n.cost_usd.toFixed(n.cost_usd < 0.01 ? 5 : 4)}` };
    case 'latency': {
      const v = nodeLatency(n);
      return { level: intensity(v, ctx.maxLatency), label: v === null ? 'timing unknown' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms` };
    }
    case 'tokens': {
      const v = nodeTokens(n);
      if (v === null && n.kind !== 'ModelCall') return null;
      return { level: intensity(v, ctx.maxTokens), label: v === null ? 'tokens unknown' : `${v.toLocaleString()} tok` };
    }
    case 'reliability': {
      const r = reliability(n);
      return { level: r === 'failed' ? 4 : r === 'ok' ? 0 : null, label: r === 'unknown' ? 'status unknown' : n.status || '', flag: r === 'failed' ? 'bad' : r === 'ok' ? 'good' : undefined };
    }
    case 'retries':
      return isRetry(n) ? { level: 4, label: `retry${typeof n.attributes?.attempt === 'number' ? ` · attempt ${n.attributes.attempt}` : ''}`, flag: 'warn' } : null;
    case 'security': {
      const s = securityLabel(n);
      return s ? { level: /high|restricted|confidential|destructive/i.test(s) ? 4 : 2, label: s, flag: /high|restricted|confidential|destructive/i.test(s) ? 'bad' : 'warn' } : null;
    }
    case 'critical':
      return ctx.critical.has(n.id) ? { level: 4, label: 'critical path' } : null;
    default:
      return null;
  }
}

export function overlayContext(nodes: GNode[], critical: Set<string> = new Set()) {
  const max = (xs: Array<number | null>) => Math.max(0, ...xs.filter((v): v is number => typeof v === 'number'));
  return { maxCost: max(nodes.map((n) => n.cost_usd)), maxLatency: max(nodes.map(nodeLatency)), maxTokens: max(nodes.map(nodeTokens)), critical };
}

function endTime(n: GNode) {
  if (!n.started_at) return null;
  const start = Date.parse(n.started_at);
  if (!Number.isFinite(start)) return null;
  if (n.ended_at && Number.isFinite(Date.parse(n.ended_at))) return Date.parse(n.ended_at);
  const d = nodeLatency(n);
  return d === null ? null : start + d;
}

/**
 * Critical path from the root: at each step follow the child that finishes
 * last. Returns the path, or the reason it cannot be computed honestly.
 */
export function criticalPath(nodes: GNode[], edges: GEdge[], rootId: string | null, back = backEdges(nodes, edges)): { status: 'ok'; path: string[]; totalMs: number } | { status: 'unavailable'; reason: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = rootId ? byId.get(rootId) : nodes.find((n) => !edges.some((e) => e.target_node_id === n.id && !back.has(e.id)));
  if (!root) return { status: 'unavailable', reason: 'The graph has no root node to start from.' };
  const out = new Map<string, string[]>();
  for (const e of edges) if (!back.has(e.id) && e.kind !== 'SERVED_BY' && e.kind !== 'LOCATED_AT') (out.get(e.source_node_id) || out.set(e.source_node_id, []).get(e.source_node_id)!).push(e.target_node_id);
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: GNode | undefined = root;
  if (endTime(root) === null) return { status: 'unavailable', reason: `The root (${root.kind}${root.name ? ` ${root.name}` : ''}) has no start time or duration, so no critical path is computed.` };
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur.id);
    const kids: GNode[] = (out.get(cur.id) || []).map((id) => byId.get(id)).filter((n): n is GNode => Boolean(n) && n!.kind !== 'Runtime' && n!.kind !== 'Outcome');
    if (!kids.length) break;
    const untimed = kids.find((k: GNode) => endTime(k) === null);
    if (untimed) return { status: 'unavailable', reason: `${untimed.kind}${untimed.name ? ` "${untimed.name}"` : ''} has no start time or duration; the critical path would be a guess.` };
    cur = kids.sort((a: GNode, b: GNode) => (endTime(b) as number) - (endTime(a) as number))[0];
  }
  const total = nodeLatency(root);
  return { status: 'ok', path, totalMs: total ?? 0 };
}

/** Case-insensitive match on name, operation, kind, model and provider. */
export function matches(n: GNode, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  const a = n.attributes || {};
  return [n.name, n.operation, n.kind, n.stable_key, a.model, a.provider, a.tool_name, a.agent_name].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
}

/** Nodes within `depth` hops of `center` (both directions), for "expand / focus neighbourhood". */
export function neighbourhood(center: string, edges: GEdge[], depth: number) {
  const keep = new Set([center]);
  let frontier = [center];
  for (let d = 0; d < depth; d += 1) {
    const next: string[] = [];
    for (const e of edges) {
      if (frontier.includes(e.source_node_id) && !keep.has(e.target_node_id)) next.push(e.target_node_id);
      if (frontier.includes(e.target_node_id) && !keep.has(e.source_node_id)) next.push(e.source_node_id);
    }
    next.forEach((id) => keep.add(id));
    frontier = next;
    if (!frontier.length) break;
  }
  return keep;
}

/** Descendants hidden when a node is collapsed (DAG edges only, so a loop cannot hide its own parent). */
export function descendants(id: string, edges: GEdge[], back: Set<string>) {
  const hidden = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (back.has(e.id) || e.source_node_id !== cur || e.target_node_id === id || hidden.has(e.target_node_id)) continue;
      hidden.add(e.target_node_id);
      stack.push(e.target_node_id);
    }
  }
  return hidden;
}
