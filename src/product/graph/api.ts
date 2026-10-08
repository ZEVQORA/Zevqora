import { api } from '@/lib/api';
import type { ZevirEvidenceRef, ZevirGraph } from '../types';
import type { GEdge, GNode } from './model';

/** Graphs up to this size load whole (paged); larger ones start from a bounded root neighbourhood. */
export const FULL_LOAD_MAX_NODES = 600;
const PAGE = 500;
const MAX_EDGES = 3000;

export interface LoadedGraph {
  graph: ZevirGraph;
  nodes: GNode[];
  edges: GEdge[];
  /** True when only part of the graph was loaded (bounded neighbourhood). */
  bounded: boolean;
  note: string | null;
}

export interface NodeDetail {
  node: GNode;
  evidence: ZevirEvidenceRef[];
  outgoing: GEdge[];
  incoming: GEdge[];
}

async function paged<T>(path: string, cap: number) {
  const out: T[] = [];
  for (let offset = 0; offset < cap; offset += PAGE) {
    const page = await api<T[]>(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&offset=${offset}`);
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

export const graphApi = {
  list: (workspaceId: string, productId?: string | null) => api<ZevirGraph[]>(`/api/zevir/graphs?workspace_id=${workspaceId}${productId ? `&product_id=${productId}` : ''}&limit=100`),
  graph: (graphId: string) => api<ZevirGraph>(`/api/zevir/graphs/${graphId}`),
  node: (graphId: string, nodeId: string) => api<NodeDetail>(`/api/zevir/graphs/${graphId}/nodes/${nodeId}`),
  neighbourhood: (graphId: string, nodeId: string, depth = 2, maxNodes = 300) => api<{ center: string; nodes: GNode[]; edges: GEdge[] }>(`/api/zevir/graphs/${graphId}/nodes/${nodeId}/neighborhood?depth=${depth}&max_nodes=${maxNodes}&direction=both`),

  /** Bounded load: whole graph when small, otherwise the root's neighbourhood. Never unlimited. */
  async load(graphId: string): Promise<LoadedGraph> {
    const graph = await graphApi.graph(graphId);
    if (graph.node_count <= FULL_LOAD_MAX_NODES) {
      const [nodes, edges] = await Promise.all([paged<GNode>(`/api/zevir/graphs/${graphId}/nodes`, FULL_LOAD_MAX_NODES), paged<GEdge>(`/api/zevir/graphs/${graphId}/edges`, MAX_EDGES)]);
      const truncatedEdges = graph.edge_count > edges.length;
      return { graph, nodes, edges, bounded: truncatedEdges, note: truncatedEdges ? `Showing ${edges.length.toLocaleString()} of ${graph.edge_count.toLocaleString()} edges.` : null };
    }
    if (!graph.root_node_id) {
      const nodes = await paged<GNode>(`/api/zevir/graphs/${graphId}/nodes`, PAGE);
      return { graph, nodes, edges: [], bounded: true, note: `This graph has ${graph.node_count.toLocaleString()} nodes and no root; showing the first ${nodes.length} without edges. Select a node to load its neighbourhood.` };
    }
    const hood = await graphApi.neighbourhood(graphId, graph.root_node_id, 2, 300);
    return { graph, nodes: hood.nodes, edges: hood.edges, bounded: true, note: `This graph has ${graph.node_count.toLocaleString()} nodes. Showing the root and everything within 2 steps (${hood.nodes.length}); expand a node to load more.` };
  },
};
