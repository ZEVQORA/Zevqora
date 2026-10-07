import { useEffect, useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useProduct } from '../store';
import { engineErrorMessage } from '../engine';
import { Button, Card, CardHeader, Empty, KeyValue, Note, StatusChip, useAsyncValue, useProductToast } from '../ui';
import { money, relativeTime, shortId } from '../format';
import type { ZevirGraph, ZevirNode } from '../types';

const NODE_ORDER = ['Task', 'Agent', 'Function', 'ModelCall', 'ToolCall', 'Retrieval', 'Runtime', 'Outcome'];

/** A missing cost is "unknown", never "$0". */
const costLabel = (v: number | null | undefined) => (v === null || v === undefined ? 'unknown' : money(v, { digits: 6 }));
const orDash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function addCounts(into: Record<string, number>, from: Record<string, number | undefined>) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] || 0) + (v || 0);
  return into;
}

function Counts({ counts, order }: { counts: Record<string, number>; order?: string[] }) {
  const keys = order ? order.filter((k) => counts[k]) : Object.keys(counts).sort();
  if (!keys.length) return <span className="text-subtle">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => <span key={k} className="pchip mono">{k} {counts[k]}</span>)}
    </div>
  );
}

function NodeDetail({ graphId, node }: { graphId: string; node: ZevirNode }) {
  const { engine } = useProduct();
  const detail = useAsyncValue(() => engine.zevirNode(graphId, node.id), [graphId, node.id]);
  const attrs = Object.entries(node.attributes || {}).filter(([, v]) => v !== null && typeof v !== 'object');
  return (
    <div className="grid gap-3 border-t border-line p-4 text-[12.5px]">
      <KeyValue items={[
        ['Kind', <span className="mono">{node.kind}{node.operation ? ` · ${node.operation}` : ''}</span>],
        ['Name', <span className="mono">{orDash(node.name)}</span>],
        ['Status', orDash(node.status)],
        ['Tokens in / out', `${orDash(node.input_tokens)} / ${orDash(node.output_tokens)}`],
        ['Cost', `${costLabel(node.cost_usd)}${node.cost_source ? ` (${node.cost_source})` : ''}`],
        ['Latency', node.latency_ms === null ? 'unknown' : `${node.latency_ms} ms`],
        ['Stable key', <span className="mono break-all">{node.stable_key}</span>],
      ]} />
      {attrs.length > 0 && <KeyValue items={attrs.slice(0, 12).map(([k, v]) => [k, <span className="mono break-all">{String(v)}</span>])} />}
      <div>
        <div className="pmetric-label">Provenance</div>
        {detail.loading && <div className="text-subtle">Loading…</div>}
        {detail.error && <Note tone="error">{detail.error}</Note>}
        {detail.data?.evidence.map((r) => (
          <div key={r.id} className="mt-2 rounded-lg border border-line p-2.5">
            <KeyValue items={[
              ['Source', <span className="mono">{r.source_kind}</span>],
              ['Source record', <span className="mono break-all">{orDash(r.source_id)}</span>],
              ['Trace / span', <span className="mono break-all">{orDash(r.source_trace_id)} / {orDash(r.source_span_id)}</span>],
              ['Source hash', <span className="mono break-all">{r.source_hash}</span>],
              ['Content', r.redaction_state === 'hashed_only' ? `not stored · sha256 ${shortId(r.content_hash || '', 12)}` : 'not stored'],
              ['Adapter', <span className="mono">{r.adapter_version} · {r.schema_version}</span>],
            ]} />
          </div>
        ))}
        {detail.data && <div className="mt-2 text-subtle">{detail.data.outgoing.length} outgoing · {detail.data.incoming.length} incoming edges</div>}
      </div>
    </div>
  );
}

function GraphDetail({ graph }: { graph: ZevirGraph }) {
  const { engine } = useProduct();
  const nodes = useAsyncValue(() => engine.zevirNodes(graph.id), [graph.id]);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const selectedNode = nodes.data?.find((n) => n.id === nodeId) || null;
  const sorted = useMemo(() => [...(nodes.data || [])].sort((a, b) => NODE_ORDER.indexOf(a.kind) - NODE_ORDER.indexOf(b.kind) || String(a.name).localeCompare(String(b.name))), [nodes.data]);
  return (
    <div className="grid gap-4 border-t border-line p-5">
      <KeyValue items={[
        ['Source', <span className="mono">{graph.source_kind}{graph.source_version ? ` · ${graph.source_version}` : ''}</span>],
        ['Source trace', <span className="mono break-all">{orDash(graph.source_trace_id)}</span>],
        ['Schema / adapter', <span className="mono">{graph.schema_version} · {graph.adapter_version}</span>],
        ['Graph hash', <span className="mono break-all">{graph.graph_hash}</span>],
        ['Nodes by kind', <Counts counts={graph.summary.node_counts as Record<string, number>} order={NODE_ORDER} />],
        ['Edges by kind', <Counts counts={graph.summary.edge_counts} />],
        ['Evidence references', String(graph.summary.evidence_refs)],
        ['Missing evidence', graph.completeness.gaps.length ? graph.completeness.gaps.map((g) => `${g.code} ×${g.count}`).join(', ') : 'none'],
      ]} />
      <div className="overflow-x-auto">
        {nodes.error && <Note tone="error">{nodes.error}</Note>}
        <table className="ptable">
          <thead><tr><th>Kind</th><th>Name</th><th>Tokens in/out</th><th>Cost</th></tr></thead>
          <tbody>
            {sorted.map((n) => (
              <tr key={n.id} className={`cursor-pointer ${n.id === nodeId ? 'bg-surface-2' : ''}`} onClick={() => setNodeId(n.id === nodeId ? null : n.id)}>
                <td className="mono">{n.kind}{n.operation ? ` · ${n.operation}` : ''}</td>
                <td className="mono max-w-[280px] truncate" title={n.name || ''}>{orDash(n.name)}</td>
                <td className="mono">{n.kind === 'ModelCall' ? `${orDash(n.input_tokens)} / ${orDash(n.output_tokens)}` : ''}</td>
                <td className="mono">{n.kind === 'ModelCall' ? costLabel(n.cost_usd) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedNode && <NodeDetail graphId={graph.id} node={selectedNode} />}
    </div>
  );
}

/** ZevIR in shadow mode: shows that the canonical graph exists and where every node came from. It decides nothing. */
export function ZevirPanel() {
  const { engine, selected, canEdit } = useProduct();
  const toast = useProductToast();
  const productId = selected?.id || '';
  const view = useAsyncValue(() => engine.zevir(productId), [engine, productId], { enabled: Boolean(productId) && engine.kind === 'cloud' });
  const [graphId, setGraphId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  useEffect(() => setGraphId(null), [productId]);

  const graphs = useMemo(() => view.data?.graphs || [], [view.data]);
  const totals = useMemo(() => {
    const nodes: Record<string, number> = {};
    const edges: Record<string, number> = {};
    let known = 0;
    let unknown = 0;
    let knownTotal: number | null = null;
    for (const g of graphs) {
      addCounts(nodes, g.summary.node_counts as Record<string, number>);
      addCounts(edges, g.summary.edge_counts);
      known += g.summary.cost.known;
      unknown += g.summary.cost.unknown;
      if (g.summary.cost.known_total_usd !== null) knownTotal = (knownTotal ?? 0) + g.summary.cost.known_total_usd;
    }
    return { nodes, edges, known, unknown, knownTotal };
  }, [graphs]);
  const current = graphs.find((g) => g.id === graphId) || null;

  const build = async () => {
    setBuilding(true);
    try {
      const out = await engine.zevirBuild(productId);
      const c = out.run.result.counts || {};
      toast({ tone: 'ok', title: out.reused ? 'Graphs already up to date' : 'Execution graphs built', description: out.reused ? 'Nothing changed since the last build.' : `${c.created || 0} new · ${c.replaced || 0} updated · ${c.unchanged || 0} unchanged` });
      view.reload();
    } catch (error) {
      toast({ tone: 'err', title: 'Could not build graphs', description: engineErrorMessage(error) });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><GitBranch size={15} /> Execution graph <span className="pchip">shadow</span></span>}
        description="ZevIR: each recorded request as a canonical graph with provenance. Observe-only — it changes no evaluation, gate or verdict."
        action={engine.kind === 'cloud' && view.data?.enabled && canEdit ? <Button size="sm" variant="secondary" onClick={() => void build()} loading={building}>Build graphs</Button> : undefined}
      />
      <div className="pcard-body p-0">
        {engine.kind !== 'cloud' ? (
          <div className="p-5"><Note>ZevIR graphs are built by the platform engine. Open this project in the web app to see them.</Note></div>
        ) : view.loading && !view.data ? (
          <div className="p-5 text-[12.5px] text-subtle">Loading…</div>
        ) : view.error ? (
          <div className="p-5"><Note tone="error">{view.error}</Note></div>
        ) : !graphs.length ? (
          <div className="p-5">
            <Empty title="No execution graphs yet" description={view.data?.enabled ? 'Build graphs to project this project’s imported traces into ZevIR.' : 'Shadow mode is off for this workspace. When it is on, imported traces are projected into ZevIR.'} />
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-5 text-[12.5px] md:grid-cols-2">
              <KeyValue items={[
                ['Graphs', `${graphs.length}${graphs.length >= 50 ? ' (latest 50)' : ''}`],
                ['Nodes by kind', <Counts counts={totals.nodes} order={NODE_ORDER} />],
                ['Edges by kind', <Counts counts={totals.edges} />],
              ]} />
              <KeyValue items={[
                ['Model calls with known cost', `${totals.known} of ${totals.known + totals.unknown}`],
                ['Known cost (lower bound)', totals.knownTotal === null ? 'unknown' : money(totals.knownTotal, { digits: 6 })],
                ['Latest build', view.data?.latest_run ? <span><StatusChip status={view.data.latest_run.status === 'succeeded' ? 'ok' : view.data.latest_run.status === 'failed' ? 'error' : view.data.latest_run.status === 'partial' ? 'missing' : 'waiting'} label={view.data.latest_run.status.toUpperCase()} /> {relativeTime(view.data.latest_run.started_at)}</span> : '—'],
              ]} />
            </div>
            <div className="overflow-x-auto">
              <table className="ptable">
                <thead><tr><th>Trace</th><th>Status</th><th>Nodes</th><th>Edges</th><th>Cost</th><th>Hash</th></tr></thead>
                <tbody>
                  {graphs.map((g) => (
                    <tr key={g.id} className={`cursor-pointer ${g.id === graphId ? 'bg-surface-2' : ''}`} onClick={() => setGraphId(g.id === graphId ? null : g.id)}>
                      <td className="mono max-w-[220px] truncate" title={g.source_trace_id || g.graph_key}>{g.source_trace_id || g.graph_key}</td>
                      <td><StatusChip status={g.status === 'complete' ? 'ok' : 'missing'} label={g.status.toUpperCase()} /></td>
                      <td className="mono">{g.node_count}</td>
                      <td className="mono">{g.edge_count}</td>
                      <td className="mono">{g.summary.cost.unknown ? (g.summary.cost.known ? `${costLabel(g.summary.cost.known_total_usd)} + unknown` : 'unknown') : costLabel(g.summary.cost.known_total_usd)}</td>
                      <td className="mono">{shortId(g.graph_hash, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {current && <GraphDetail graph={current} />}
          </>
        )}
      </div>
    </Card>
  );
}
