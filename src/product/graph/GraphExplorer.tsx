import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, Boxes, Cpu, Database, FunctionSquare, GitBranch, ListTree, Maximize2, Minimize2, Network, Search, Server, Target, Wrench } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { ClaimBadge, Unknown } from '@/components/ui/Claim';
import { CopyableHash } from '@/components/ui/Evidence';
import { DataTable } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Overlay';
import { SegmentedControl } from '@/components/ui/Segmented';
import { EmptyState, ErrorState, LoadingState, InlineNotice } from '@/components/ui/States';
import { ButtonLink, Button } from '@/components/ui/Button';
import { useProduct } from '../store';
import { graphApi, type LoadedGraph } from './api';
import { NODE_H, NODE_KINDS, NODE_W, backEdges, criticalPath, descendants, layout, matches, neighbourhood, nodeLatency, nodeTokens, overlayContext, overlayValue, securityLabel, type GEdge, type GNode, type Overlay } from './model';

const KIND_ICON: Record<string, typeof Cpu> = { Task: Target, Agent: Bot, Function: FunctionSquare, ModelCall: Cpu, ToolCall: Wrench, Retrieval: Database, Runtime: Server, Outcome: Boxes };

const OVERLAYS: Array<{ value: Overlay; label: string; experimental?: boolean }> = [
  { value: 'none', label: 'Structure' },
  { value: 'cost', label: 'Cost' },
  { value: 'latency', label: 'Latency' },
  { value: 'critical', label: 'Critical path' },
  { value: 'reliability', label: 'Reliability' },
  { value: 'retries', label: 'Retries' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'security', label: 'Security', experimental: true },
];

const LEVEL_BG = ['bg-surface', 'bg-blue-50', 'bg-[#cfe0ff]', 'bg-[#a9c8ff]', 'bg-[#7fb0ff]'];

interface NodeData extends Record<string, unknown> {
  node: GNode;
  overlay: Overlay;
  value: ReturnType<typeof overlayValue>;
  dim: boolean;
  compact: boolean;
  collapsed: boolean;
  hiddenCount: number;
}

const ZevNode = memo(function ZevNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const { node, value, dim, compact, collapsed, hiddenCount, overlay } = data;
  const Icon = KIND_ICON[node.kind] || Boxes;
  const v = value;
  const bad = v?.flag === 'bad';
  const warn = v?.flag === 'warn';
  const unknown = v && v.level === null && overlay !== 'none';
  const bg = v && v.level !== null && !bad && !warn ? LEVEL_BG[v.level] : 'bg-surface';
  const model = typeof node.attributes?.model === 'string' ? node.attributes.model : null;
  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col justify-center rounded-[12px] border px-3 text-left shadow-[0_1px_2px_rgb(15_17_21/0.06)] transition-[opacity,box-shadow]',
        bg,
        bad ? 'border-rejected bg-rejected-bg' : warn ? 'border-warning bg-warning-bg' : overlay === 'critical' && v ? 'border-accent ring-2 ring-accent/40' : 'border-line',
        unknown && 'bg-[repeating-linear-gradient(135deg,var(--zq-surface),var(--zq-surface)_6px,var(--zq-sunken)_6px,var(--zq-sunken)_12px)]',
        selected && 'ring-2 ring-[var(--zq-focus)] ring-offset-1',
        dim && 'opacity-30',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon size={13} aria-hidden className="shrink-0 text-accent-text" />
        <span className="font-mono text-[10px] uppercase tracking-wide text-subtle">{node.kind}</span>
        {collapsed && <span className="ml-auto rounded-sm bg-ink/10 px-1 font-mono text-[9.5px] text-muted">+{hiddenCount}</span>}
      </div>
      <div className="mt-0.5 truncate text-[12.5px] font-medium text-ink" title={node.name || node.operation || node.stable_key}>{node.name || node.operation || model || node.stable_key}</div>
      {!compact && <div className={cn('mt-0.5 truncate font-mono text-[10.5px] tnum', bad ? 'text-rejected' : warn ? 'text-warning' : 'text-muted')}>{v ? v.label : model || node.operation || ' '}</div>}
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
    </div>
  );
});

const NODE_TYPES = { zev: ZevNode };

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 border-b border-line py-1.5 text-[12px] last:border-0">
      <dt className="text-subtle">{k}</dt>
      <dd className="min-w-0 break-words font-mono text-[11.5px] text-ink">{v}</dd>
    </div>
  );
}

/** Node inspector: only fields that are actually present are shown. */
function NodeInspector({ graphId, node, onFocus, onExpand, onCollapse, collapsed, bounded }: { graphId: string; node: GNode; onFocus: (depth: number) => void; onExpand: () => void; onCollapse: () => void; collapsed: boolean; bounded: boolean }) {
  const detail = useAsync(() => graphApi.node(graphId, node.id), [graphId, node.id]);
  const a = node.attributes || {};
  const lat = nodeLatency(node);
  const rows: Array<[string, React.ReactNode]> = [];
  const add = (k: string, v: unknown, render?: React.ReactNode) => {
    if (v === null || v === undefined || v === '') return;
    rows.push([k, render ?? String(v)]);
  };
  add('Kind', node.kind);
  add('Operation', node.operation);
  add('Provider', a.provider);
  add('Model', a.model);
  add('Status', node.status);
  rows.push(['Cost', node.cost_usd === null ? <Unknown reason="No recognised cost source for this node." /> : `$${node.cost_usd.toFixed(6)}`]);
  add('Cost source', node.cost_source);
  rows.push(['Latency', lat === null ? <Unknown reason="No timing recorded." /> : `${Math.round(lat)} ms`]);
  add('TTFT', node.ttft_ms, node.ttft_ms !== null ? `${Math.round(node.ttft_ms)} ms` : undefined);
  add('Input tokens', node.input_tokens);
  add('Output tokens', node.output_tokens);
  add('Cached input tokens', node.cached_input_tokens);
  add('Reasoning tokens', node.reasoning_tokens);
  add('Attempt', a.attempt);
  add('Retry reason', a.retry_reason);
  add('Started', node.started_at);
  add('Data sensitivity', node.data_sensitivity);
  add('Action risk', node.action_risk);
  add('Trust class', node.trust_class);
  add('Tool', a.tool_name);
  add('Agent', a.agent_name);
  add('Documents', a.document_count);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="secondary" onClick={() => onFocus(1)}>Focus 1 step</Button>
        <Button size="xs" variant="secondary" onClick={() => onFocus(2)}>Focus 2 steps</Button>
        <Button size="xs" variant="secondary" onClick={collapsed ? onExpand : onCollapse}>{collapsed ? <><Maximize2 size={12} aria-hidden /> Expand</> : <><Minimize2 size={12} aria-hidden /> Collapse subtree</>}</Button>
        {bounded && <Button size="xs" variant="secondary" onClick={onExpand}><Network size={12} aria-hidden /> Load neighbourhood</Button>}
      </div>
      <dl>{rows.map(([k, v]) => <Field key={k} k={k} v={v} />)}</dl>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">Identifiers</h3>
        <dl className="mt-1">
          <Field k="Node id" v={<CopyableHash value={node.id} label="node id" />} />
          <Field k="Stable key" v={<CopyableHash value={node.stable_key} label="stable key" chars={18} />} />
        </dl>
      </div>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">Provenance</h3>
        {detail.loading && <LoadingState label="Loading provenance" rows={2} className="mt-2" />}
        {detail.error && <p className="mt-1 text-[12px] text-rejected">{detail.error}</p>}
        {detail.data && !detail.data.evidence.length && <p className="mt-1 text-[12px] text-muted">No evidence reference is attached to this node.</p>}
        {detail.data?.evidence.map((r) => (
          <dl key={r.id} className="mt-2 rounded-md border border-line px-2.5 py-1">
            <Field k="Source" v={r.source_kind} />
            {r.source_trace_id && <Field k="Source trace id" v={<CopyableHash value={r.source_trace_id} label="source trace id" chars={16} />} />}
            {r.source_span_id && <Field k="Source span id" v={<CopyableHash value={r.source_span_id} label="source span id" chars={16} />} />}
            <Field k="Evidence hash" v={<CopyableHash value={r.source_hash} label="evidence hash" />} />
            <Field k="Schema / adapter" v={`${r.schema_version} · ${r.adapter_version}`} />
            <Field k="Content" v={r.redaction_state === 'hashed_only' ? 'not stored (hash only)' : 'not stored'} />
          </dl>
        ))}
      </div>
      {detail.data && (detail.data.incoming.length > 0 || detail.data.outgoing.length > 0) && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">Edges</h3>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11.5px] text-ink">
            {detail.data.incoming.slice(0, 20).map((e) => <li key={e.id}>← {e.kind}{e.ordinal !== null ? ` #${e.ordinal}` : ''}</li>)}
            {detail.data.outgoing.slice(0, 20).map((e) => <li key={e.id}>→ {e.kind}{e.ordinal !== null ? ` #${e.ordinal}` : ''}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function EdgeInspector({ edge, nodes, back }: { edge: GEdge; nodes: Map<string, GNode>; back: boolean }) {
  const s = nodes.get(edge.source_node_id);
  const t = nodes.get(edge.target_node_id);
  return (
    <dl>
      <Field k="Kind" v={edge.kind} />
      {edge.ordinal !== null && <Field k="Ordinal" v={edge.ordinal} />}
      <Field k="From" v={s ? `${s.kind} · ${s.name || s.stable_key}` : edge.source_node_id} />
      <Field k="To" v={t ? `${t.kind} · ${t.name || t.stable_key}` : edge.target_node_id} />
      {back && <Field k="Loop" v="Closes a cycle (drawn dashed). Graphs are not assumed to be acyclic." />}
      <Field k="Edge id" v={<CopyableHash value={edge.id} label="edge id" />} />
    </dl>
  );
}

function Canvas({ loaded, overlay, kinds, query, selected, onSelect, onSelectEdge, focus, collapsed, criticalIds, showMap }: { loaded: LoadedGraph; overlay: Overlay; kinds: Set<string>; query: string; selected: string | null; onSelect: (id: string | null) => void; onSelectEdge: (id: string) => void; focus: Set<string> | null; collapsed: Set<string>; criticalIds: Set<string>; showMap: boolean }) {
  const { fitView } = useReactFlow();
  const back = useMemo(() => backEdges(loaded.nodes, loaded.edges), [loaded]);
  const hidden = useMemo(() => {
    const h = new Set<string>();
    for (const id of collapsed) for (const d of descendants(id, loaded.edges, back)) h.add(d);
    return h;
  }, [collapsed, loaded.edges, back]);
  const visibleNodes = useMemo(() => loaded.nodes.filter((n) => kinds.has(n.kind) && !hidden.has(n.id) && (!focus || focus.has(n.id))), [loaded.nodes, kinds, hidden, focus]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => loaded.edges.filter((e) => visibleIds.has(e.source_node_id) && visibleIds.has(e.target_node_id)), [loaded.edges, visibleIds]);
  const pos = useMemo(() => layout(visibleNodes, visibleEdges, back).positions, [visibleNodes, visibleEdges, back]);
  const ctx = useMemo(() => overlayContext(visibleNodes, criticalIds), [visibleNodes, criticalIds]);
  const compact = visibleNodes.length > 150;

  const nodes: Array<Node<NodeData>> = useMemo(
    () =>
      visibleNodes.map((n) => ({
        id: n.id,
        type: 'zev',
        position: pos.get(n.id) ? { x: pos.get(n.id)!.x, y: pos.get(n.id)!.y } : { x: 0, y: 0 },
        width: NODE_W,
        height: compact ? 46 : NODE_H,
        selected: n.id === selected,
        ariaLabel: `${n.kind} ${n.name || n.stable_key}`,
        data: { node: n, overlay, value: overlay === 'none' ? null : overlayValue(n, overlay, ctx), dim: Boolean(query) && !matches(n, query), compact, collapsed: collapsed.has(n.id), hiddenCount: collapsed.has(n.id) ? descendants(n.id, loaded.edges, back).size : 0 },
      })),
    [visibleNodes, pos, compact, selected, overlay, ctx, query, collapsed, loaded.edges, back],
  );
  const edges: Edge[] = useMemo(
    () =>
      visibleEdges.map((e) => {
        const loop = back.has(e.id);
        const crit = overlay === 'critical' && criticalIds.has(e.source_node_id) && criticalIds.has(e.target_node_id);
        return {
          id: e.id,
          source: e.source_node_id,
          target: e.target_node_id,
          type: loop ? 'default' : 'smoothstep',
          label: loop ? `${e.kind} · loop` : visibleEdges.length <= 60 ? e.kind : undefined,
          labelStyle: { fontSize: 9.5, fontFamily: 'var(--font-mono)', fill: 'var(--zq-fg-subtle)' },
          labelBgStyle: { fill: 'var(--zq-canvas)' },
          animated: loop,
          style: { stroke: crit ? 'var(--zq-accent)' : loop ? 'var(--zq-warning)' : 'var(--zq-border-strong)', strokeWidth: crit ? 3 : 1.4, strokeDasharray: loop ? '5 4' : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: crit ? 'var(--zq-accent)' : 'var(--zq-border-strong)' },
        };
      }),
    [visibleEdges, back, overlay, criticalIds],
  );

  useEffect(() => {
    const t = window.setTimeout(() => fitView({ padding: 0.15, duration: 250 }), 30);
    return () => window.clearTimeout(t);
  }, [fitView, loaded.graph.id, focus, kinds.size]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, n) => onSelect(n.id)}
      onEdgeClick={(_, e) => onSelectEdge(e.id)}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable
      onlyRenderVisibleElements={nodes.length > 80}
      minZoom={0.1}
      maxZoom={2}
      fitView
      proOptions={{ hideAttribution: true }}
      ariaLabelConfig={{ 'node.a11yDescription.default': 'Press Enter or Space to inspect this node.' }}
    >
      <Background gap={22} size={1} color="rgb(15 17 21 / 0.08)" />
      <Controls showInteractive={false} position="bottom-left" />
      {nodes.length > 12 && showMap && <MiniMap pannable zoomable position="bottom-right" style={{ width: 150, height: 96 }} nodeColor={(n) => ((n.data as NodeData).node.id === selected ? 'var(--zq-accent)' : 'var(--zq-stone-300)')} maskColor="rgb(247 248 250 / 0.7)" />}
    </ReactFlow>
  );
}

const SOURCE_LABEL: Record<string, string> = { zevqora_engine: 'Engine', openinference: 'OpenInference', otel_genai: 'OTel GenAI' };
/** The readable tail of a graph key (the source trace or request id). */
function shortKey(key: string) {
  const tail = key.split(':').pop() || key;
  return tail.replace(/^0+(?=\d)/, '') || tail;
}

function GraphPicker({ graphs, value, onChange }: { graphs: Array<{ id: string; graph_key: string; source_kind: string; node_count: number; status: string; summary: { cost: { known_total_usd: number | null; unknown: number } }; updated_at: string }>; value: string | null; onChange: (id: string) => void }) {
  const [sort, setSort] = useState<'recent' | 'cost' | 'size'>('recent');
  const list = useMemo(() => {
    const g = [...graphs];
    if (sort === 'cost') g.sort((a, b) => (b.summary.cost.known_total_usd ?? -1) - (a.summary.cost.known_total_usd ?? -1));
    if (sort === 'size') g.sort((a, b) => b.node_count - a.node_count);
    return g;
  }, [graphs, sort]);
  return (
    <div className="flex min-h-0 flex-col">
      <SegmentedControl size="sm" label="Sort graphs" value={sort} onChange={setSort} options={[{ value: 'recent', label: 'Recent' }, { value: 'cost', label: 'Cost' }, { value: 'size', label: 'Size' }]} className="mb-2" />
      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" aria-label="Execution graphs">
        {list.map((g) => (
          <li key={g.id}>
            <button type="button" aria-current={g.id === value ? 'true' : undefined} onClick={() => onChange(g.id)} className={cn('w-full rounded-md px-2.5 py-2 text-left transition-control', g.id === value ? 'bg-accent-subtle' : 'hover:bg-ink/[0.03]')}>
              <span className="flex items-center gap-1.5">
                <span className="shrink-0 rounded-xs bg-sunken px-1 font-mono text-[9.5px] uppercase text-muted">{SOURCE_LABEL[g.source_kind] || g.source_kind}</span>
                <span className="truncate font-mono text-[11.5px] text-ink" title={g.graph_key}>{shortKey(g.graph_key)}</span>
              </span>
              <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-subtle">
                <span>{g.node_count} nodes</span>
                <span>{g.summary.cost.known_total_usd === null ? 'cost unknown' : `$${g.summary.cost.known_total_usd.toFixed(5)}`}{g.summary.cost.unknown ? ` · ${g.summary.cost.unknown} unpriced` : ''}</span>
                {g.status !== 'complete' && <span className="text-warning">incomplete</span>}
                <span>{relativeTime(g.updated_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function GraphExplorer() {
  const { activeWorkspace } = useSession();
  const { selected: product } = useProduct();
  const [params, setParams] = useSearchParams();
  const features = activeWorkspace?.features || {};
  const enabled = Boolean(features.zevir_graph_ui);
  const experimental = Boolean(features.experimental_graph_overlays);
  const wsId = activeWorkspace?.id || '';
  const graphs = useAsync(() => graphApi.list(wsId, product?.id), [wsId, product?.id], { enabled: enabled && Boolean(wsId) });
  // Default to the richest graph (most nodes): it shows the most of how the workload executes.
  const graphId = params.get('graph') || [...(graphs.data || [])].sort((a, b) => b.node_count - a.node_count)[0]?.id || null;
  const [loaded, setLoaded] = useState<LoadedGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('cost');
  const [kinds, setKinds] = useState<Set<string>>(() => new Set(NODE_KINDS));
  const [query, setQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(params.get('node'));
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [focus, setFocus] = useState<Set<string> | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [listView, setListView] = useState(false);
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 1024 : false));

  useEffect(() => {
    document.title = 'Execution Graph — ZEVQORA';
    const onResize = () => setNarrow(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!graphId || !enabled) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setFocus(null);
    setCollapsed(new Set());
    graphApi
      .load(graphId)
      .then((g) => alive && setLoaded(g))
      .catch((e: Error) => alive && setLoadError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [graphId, enabled]);

  const back = useMemo(() => (loaded ? backEdges(loaded.nodes, loaded.edges) : new Set<string>()), [loaded]);
  const critical = useMemo(() => (loaded ? criticalPath(loaded.nodes, loaded.edges, loaded.graph.root_node_id, back) : null), [loaded, back]);
  const criticalIds = useMemo(() => new Set(critical?.status === 'ok' ? critical.path : []), [critical]);
  const nodeById = useMemo(() => new Map((loaded?.nodes || []).map((n) => [n.id, n])), [loaded]);
  const node = selectedNode ? nodeById.get(selectedNode) || null : null;
  const edge = selectedEdge ? loaded?.edges.find((e) => e.id === selectedEdge) || null : null;
  const matchCount = useMemo(() => (query && loaded ? loaded.nodes.filter((n) => matches(n, query)).length : 0), [query, loaded]);
  const cycles = back.size;

  const selectNode = useCallback(
    (id: string | null) => {
      setSelectedNode(id);
      setSelectedEdge(null);
      const next = new URLSearchParams(params);
      if (graphId) next.set('graph', graphId);
      if (id) next.set('node', id);
      else next.delete('node');
      setParams(next, { replace: true });
    },
    [params, setParams, graphId],
  );

  const expand = useCallback(async () => {
    if (!loaded || !node) return;
    setCollapsed((c) => {
      const n = new Set(c);
      n.delete(node.id);
      return n;
    });
    if (!loaded.bounded) return;
    try {
      const hood = await graphApi.neighbourhood(loaded.graph.id, node.id, 2, 300);
      setLoaded((g) => {
        if (!g) return g;
        const nodes = new Map(g.nodes.map((n) => [n.id, n]));
        for (const n of hood.nodes) nodes.set(n.id, n);
        const edges = new Map(g.edges.map((e) => [e.id, e]));
        for (const e of hood.edges) edges.set(e.id, e);
        return { ...g, nodes: [...nodes.values()], edges: [...edges.values()], note: `${nodes.size.toLocaleString()} of ${g.graph.node_count.toLocaleString()} nodes loaded. Expand nodes to load more.` };
      });
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [loaded, node]);

  if (!enabled) {
    return (
      <div className="mx-auto w-full max-w-[960px] px-4 py-10 lg:px-8">
        <EmptyState zev="pose-sitting" title="The Graph Explorer is not enabled for this workspace" description="An admin can turn on the zevir_graph_ui flag for this workspace. The underlying ZevIR graphs are unaffected either way." />
      </div>
    );
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface/80 px-3 py-2">
      <label className="relative flex min-w-[180px] flex-1 items-center sm:max-w-[260px]">
        <span className="sr-only">Search nodes</span>
        <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 text-subtle" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, model, tool…" className="h-8 w-full rounded-md border border-line-control bg-surface pl-8 pr-2 text-[12.5px] text-ink" />
      </label>
      {query && <span role="status" className="text-[11.5px] text-muted">{matchCount} match{matchCount === 1 ? '' : 'es'}</span>}
      <label className="sr-only" htmlFor="overlay-select">Overlay</label>
      <select id="overlay-select" value={overlay} onChange={(e) => setOverlay(e.target.value as Overlay)} className="h-8 rounded-md border border-line-control bg-surface px-2 text-[12.5px] text-ink">
        {OVERLAYS.filter((o) => !o.experimental || experimental).map((o) => <option key={o.value} value={o.value}>{`Overlay: ${o.label}`}</option>)}
      </select>
      <details className="relative">
        <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-line-control bg-surface px-2.5 text-[12.5px] text-ink">Node kinds ({kinds.size}/{NODE_KINDS.length})</summary>
        <fieldset className="glass-pop absolute left-0 z-20 mt-1 grid w-56 gap-1 rounded-lg p-2">
          <legend className="sr-only">Show node kinds</legend>
          {NODE_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-[12.5px] text-ink hover:bg-ink/5">
              <input type="checkbox" checked={kinds.has(k)} onChange={(e) => setKinds((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
              {k}
            </label>
          ))}
        </fieldset>
      </details>
      {focus && <Button size="xs" variant="secondary" onClick={() => setFocus(null)}>Show whole graph</Button>}
      <Button size="xs" variant="ghost" onClick={() => setListView((v) => !v)} aria-pressed={listView}><ListTree size={13} aria-hidden /> {listView ? 'Canvas' : 'List view'}</Button>
    </div>
  );

  const inspector = node && loaded ? (
    <NodeInspector graphId={loaded.graph.id} node={node} bounded={loaded.bounded} collapsed={collapsed.has(node.id)} onFocus={(d) => setFocus(neighbourhood(node.id, loaded.edges, d))} onCollapse={() => setCollapsed((c) => new Set(c).add(node.id))} onExpand={() => void expand()} />
  ) : edge && loaded ? (
    <EdgeInspector edge={edge} nodes={nodeById} back={back.has(edge.id)} />
  ) : null;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-[1.25rem] font-bold tracking-[-0.02em] text-ink">Execution Graph</h1>
          <p className="text-[12px] text-muted">ZevIR: how {product?.name || 'this workspace'} actually executes. Unknown cost and missing timing are shown as unknown, never as zero.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ClaimBadge claim="OBSERVED" size="xs" />
          {loaded && <span className="font-mono text-[11px] text-subtle">{loaded.nodes.length}/{loaded.graph.node_count} nodes · {loaded.edges.length} edges{cycles ? ` · ${cycles} loop${cycles === 1 ? '' : 's'}` : ''}</span>}
        </div>
      </div>
      {graphs.loading && <div className="p-6"><LoadingState label="Loading graphs" /></div>}
      {graphs.error && <div className="p-6"><ErrorState message={graphs.error} onRetry={() => void graphs.reload()} /></div>}
      {graphs.data && !graphs.data.length && (
        <div className="p-6">
          <EmptyState zev="pose-thinking" title="No execution graphs yet" description="Graphs are built from imported traces (ZevIR shadow mode). Import OpenTelemetry / OpenInference spans or a trace file, or build graphs from this workload's traces." action={<><ButtonLink to="/app/connections">Import evidence</ButtonLink><ButtonLink to="/app/project" variant="secondary"><GitBranch size={13} aria-hidden /> Build from traces</ButtonLink></>} />
        </div>
      )}
      {graphs.data && graphs.data.length > 0 && (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_1fr_360px]">
          <aside className="flex max-h-[34vh] min-h-0 flex-col border-b border-line p-3 lg:max-h-none lg:border-b-0 lg:border-r" aria-label="Graphs">
            <GraphPicker graphs={graphs.data} value={graphId} onChange={(id) => { setParams({ graph: id }); setSelectedNode(null); }} />
          </aside>
          <section className="flex min-h-[60vh] min-w-0 flex-col" aria-label="Graph canvas">
            {toolbar}
            {loaded?.note && <InlineNotice tone="info" className="m-2">{loaded.note}</InlineNotice>}
            {overlay === 'critical' && critical?.status === 'unavailable' && <InlineNotice tone="warning" className="m-2">No critical path: {critical.reason}</InlineNotice>}
            {overlay === 'critical' && critical?.status === 'ok' && <p className="px-3 pt-2 text-[11.5px] text-muted">Critical path: {critical.path.length} nodes, root duration {Math.round(critical.totalMs)} ms. Each step follows the child that finished last.</p>}
            {loading && <div className="p-6"><LoadingState label="Loading graph" /></div>}
            {loadError && <div className="p-4"><ErrorState compact message={loadError} /></div>}
            {loaded && !loading && (listView ? (
              <div className="p-3">
                <DataTable
                  caption={`${loaded.nodes.length} nodes in this graph`}
                  rows={loaded.nodes.filter((n) => kinds.has(n.kind) && matches(n, query))}
                  rowKey={(n) => n.id}
                  onRowClick={(n) => selectNode(n.id)}
                  rowClassName={(n) => (n.id === selectedNode ? 'bg-accent-subtle' : undefined)}
                  minWidth={720}
                  dense
                  columns={[
                    { key: 'kind', header: 'Kind', sort: (n) => n.kind, nowrap: true, cell: (n) => <span className="font-mono text-[12px]">{n.kind}</span> },
                    { key: 'name', header: 'Name', sort: (n) => n.name, cell: (n) => <button type="button" className="text-left hover:text-accent-text" onClick={() => selectNode(n.id)}>{n.name || n.operation || n.stable_key}</button> },
                    { key: 'cost', header: 'Cost', align: 'right', sort: (n) => n.cost_usd, cell: (n) => (n.cost_usd === null ? <Unknown /> : `$${n.cost_usd.toFixed(6)}`) },
                    { key: 'lat', header: 'Latency', align: 'right', sort: (n) => nodeLatency(n), cell: (n) => (nodeLatency(n) === null ? <Unknown /> : `${Math.round(nodeLatency(n)!)} ms`) },
                    { key: 'tok', header: 'Tokens', align: 'right', sort: (n) => nodeTokens(n), cell: (n) => (nodeTokens(n) === null ? '—' : nodeTokens(n)!.toLocaleString()) },
                    { key: 'sec', header: 'Policy', cell: (n) => securityLabel(n) || '—' },
                  ]}
                />
              </div>
            ) : (
              <div className="relative min-h-[60vh] flex-1 bg-canvas" style={{ touchAction: 'none' }}>
                <ReactFlowProvider>
                  <Canvas loaded={loaded} overlay={overlay} kinds={kinds} query={query} selected={selectedNode} onSelect={selectNode} onSelectEdge={(id) => { setSelectedEdge(id); setSelectedNode(null); }} focus={focus} collapsed={collapsed} criticalIds={criticalIds} showMap={!narrow} />
                </ReactFlowProvider>
              </div>
            ))}
          </section>
          {!narrow && (
            <aside className="hidden min-h-0 overflow-y-auto border-l border-line p-4 lg:block" aria-label="Inspector">
              {inspector ? (
                <>
                  <h2 className="mb-3 text-[14px] font-semibold text-ink">{node ? `${node.kind} · ${node.name || node.operation || 'node'}` : `Edge · ${edge?.kind}`}</h2>
                  {inspector}
                </>
              ) : (
                <div className="text-[12.5px] text-muted">
                  <p>Select a node or an edge to inspect it.</p>
                  {loaded && (
                    <dl className="mt-4">
                      <Field k="Graph" v={<CopyableHash value={loaded.graph.id} label="graph id" />} />
                      <Field k="Source" v={`${loaded.graph.source_kind} · ${loaded.graph.adapter_version}`} />
                      <Field k="Schema" v={loaded.graph.schema_version} />
                      {loaded.graph.source_trace_id && <Field k="Source trace" v={<CopyableHash value={loaded.graph.source_trace_id} label="source trace id" />} />}
                      <Field k="Graph hash" v={<CopyableHash value={loaded.graph.graph_hash} label="graph hash" />} />
                      <Field k="Completeness" v={loaded.graph.status} />
                      {loaded.graph.completeness?.gaps?.length > 0 && <Field k="Gaps" v={loaded.graph.completeness.gaps.map((g) => `${g.code} ×${g.count}`).join(', ')} />}
                      <Field k="Known cost" v={loaded.graph.summary.cost.known_total_usd === null ? <Unknown /> : `$${loaded.graph.summary.cost.known_total_usd.toFixed(6)} (${loaded.graph.summary.cost.unknown} unpriced)`} />
                    </dl>
                  )}
                </div>
              )}
            </aside>
          )}
        </div>
      )}
      {narrow && (
        <Drawer open={Boolean(inspector)} onClose={() => { setSelectedNode(null); setSelectedEdge(null); }} title={node ? `${node.kind} · ${node.name || node.operation || 'node'}` : `Edge · ${edge?.kind || ''}`}>
          {inspector}
        </Drawer>
      )}
    </div>
  );
}
