/**
 * ZevIR Graph Explorer model: graphs are not assumed to be DAGs, unknown
 * values stay unknown, the critical path is computed only from complete
 * timing, and large graphs lay out without freezing.
 */
import { describe, expect, it } from 'vitest';
import { backEdges, criticalPath, descendants, layout, matches, neighbourhood, overlayContext, overlayValue, type GEdge, type GNode } from '../src/product/graph/model';

const node = (id: string, over: Partial<GNode> = {}): GNode => ({
  id, stable_key: id, kind: 'ModelCall', name: id, operation: null, started_at: null, duration_ms: null, status: null, cost_usd: null, cost_source: null,
  latency_ms: null, ttft_ms: null, input_tokens: null, output_tokens: null, cached_input_tokens: null, reasoning_tokens: null, attributes: {}, ...over,
});
const edge = (id: string, s: string, t: string, kind = 'CALLS'): GEdge => ({ id, source_node_id: s, target_node_id: t, kind, ordinal: null });

describe('cycles', () => {
  it('finds the edge that closes an agent loop, including self-loops', () => {
    const nodes = ['a', 'b', 'c'].map((id) => node(id, { kind: 'Agent' }));
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ca', 'c', 'a'), edge('cc', 'c', 'c')];
    const back = backEdges(nodes, edges);
    expect(back.has('ca')).toBe(true);
    expect(back.has('cc')).toBe(true);
    expect(back.has('ab') || back.has('bc')).toBe(false);
  });

  it('lays out a cyclic graph in layers without looping forever', () => {
    const nodes = ['t', 'a', 'm', 'tool'].map((id) => node(id));
    const edges = [edge('1', 't', 'a'), edge('2', 'a', 'm'), edge('3', 'm', 'tool'), edge('4', 'tool', 'a')];
    const { positions, back } = layout(nodes, edges);
    expect(back.has('4')).toBe(true);
    expect(positions.get('t')!.layer).toBe(0);
    expect(positions.get('a')!.layer).toBe(1);
    expect(positions.get('tool')!.layer).toBe(3);
  });

  it('collapsing a node inside a loop never hides the node itself or loops forever', () => {
    const edges = [edge('1', 'a', 'b'), edge('2', 'b', 'c'), edge('3', 'c', 'a')];
    const back = backEdges(['a', 'b', 'c'].map((id) => node(id)), edges);
    const hidden = descendants('a', edges, back);
    expect([...hidden].sort()).toEqual(['b', 'c']);
    expect(hidden.has('a')).toBe(false);
  });

  it('neighbourhood expansion is bounded by depth', () => {
    const edges = [edge('1', 'a', 'b'), edge('2', 'b', 'c'), edge('3', 'c', 'd')];
    expect([...neighbourhood('b', edges, 1)].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('critical path', () => {
  const t0 = '2026-09-01T10:00:00.000Z';
  const at = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();

  it('follows the child that finished last when every node is timed', () => {
    const nodes = [node('root', { kind: 'Task', started_at: at(0), duration_ms: 1000 }), node('fast', { started_at: at(0), duration_ms: 200 }), node('slow', { started_at: at(100), duration_ms: 800 }), node('rt', { kind: 'Runtime' })];
    const edges = [edge('1', 'root', 'fast'), edge('2', 'root', 'slow'), edge('3', 'slow', 'rt', 'SERVED_BY')];
    const cp = criticalPath(nodes, edges, 'root');
    expect(cp).toEqual({ status: 'ok', path: ['root', 'slow'], totalMs: 1000 });
  });

  it('refuses to guess when a child on the path has no timing', () => {
    const nodes = [node('root', { kind: 'Task', started_at: at(0), duration_ms: 1000 }), node('untimed', { name: 'kb_search', kind: 'Retrieval' })];
    const cp = criticalPath(nodes, [edge('1', 'root', 'untimed')], 'root');
    expect(cp.status).toBe('unavailable');
    if (cp.status === 'unavailable') expect(cp.reason).toMatch(/kb_search.*no start time/);
  });

  it('refuses when the root itself is untimed', () => {
    expect(criticalPath([node('root')], [], 'root').status).toBe('unavailable');
  });
});

describe('overlays keep unknown as unknown', () => {
  it('an unpriced model call is "cost unknown", not $0, and gets no intensity level', () => {
    const n = node('m');
    const v = overlayValue(n, 'cost', overlayContext([n]));
    expect(v).toEqual({ level: null, label: 'cost unknown' });
  });

  it('missing timing is "timing unknown"', () => {
    const n = node('m');
    expect(overlayValue(n, 'latency', overlayContext([n]))?.label).toBe('timing unknown');
  });

  it('a known zero cost is shown as a real $0, distinct from unknown', () => {
    const n = node('m', { cost_usd: 0 });
    expect(overlayValue(n, 'cost', overlayContext([n]))?.label).toBe('$0.00000');
  });

  it('reliability and retries come from recorded status and attempt only', () => {
    const failed = node('f', { status: 'error' });
    const retry = node('r', { attributes: { attempt: 2 } });
    const ctx = overlayContext([failed, retry]);
    expect(overlayValue(failed, 'reliability', ctx)?.flag).toBe('bad');
    expect(overlayValue(node('x'), 'reliability', ctx)?.label).toBe('status unknown');
    expect(overlayValue(retry, 'retries', ctx)?.label).toBe('retry · attempt 2');
    expect(overlayValue(node('y'), 'retries', ctx)).toBeNull();
  });

  it('search matches name, model and tool attributes', () => {
    expect(matches(node('a', { attributes: { model: 'openai/gpt-4o' } }), 'gpt-4o')).toBe(true);
    expect(matches(node('a', { attributes: { tool_name: 'lookup_order' } }), 'LOOKUP')).toBe(true);
    expect(matches(node('a'), 'nothing-here')).toBe(false);
  });
});

describe('scale', () => {
  it('lays out a 5,000-node graph with loops in well under a second', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => node(`n${i}`));
    const edges: GEdge[] = [];
    for (let i = 1; i < 5000; i += 1) edges.push(edge(`e${i}`, `n${Math.floor((i - 1) / 3)}`, `n${i}`));
    // Each loop edge points back to the grandparent, so it really closes a cycle.
    for (let i = 10; i < 5000; i += 97) edges.push(edge(`loop${i}`, `n${i}`, `n${Math.floor((Math.floor((i - 1) / 3) - 1) / 3)}`));
    const t = performance.now();
    const { positions, back } = layout(nodes, edges);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(positions.size).toBe(5000);
    expect(back.size).toBeGreaterThan(0);
  });
});
