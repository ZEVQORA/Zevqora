import { api, ApiClientError } from '@/lib/api';
import type { ZevirGraph } from '@/product/types';
import type { CapabilityAvailability } from '../contracts/claims';

/**
 * Workspace evidence status, read from the EXISTING ZevIR API only:
 *   GET /api/zevir/graphs?workspace_id=…   (server checks viewer membership)
 *
 * The server has no connection-health or provider-verification endpoint, so the
 * strongest state this gateway can report is "evidence received": the server
 * returned at least one graph for that source kind, with its own timestamp.
 * It never reports CONNECTED or HEALTHY, and never fills in a missing reading.
 */
export type ZevirSourceKind = ZevirGraph['source_kind'];
export const ZEVIR_SOURCE_KINDS: readonly ZevirSourceKind[] = ['zevqora_engine', 'otel_genai', 'openinference'];

export type EvidenceSourceState = 'evidence_received' | 'no_evidence' | 'ingest_disabled';

export interface EvidenceSourceStatus {
  sourceKind: ZevirSourceKind;
  state: EvidenceSourceState;
  /** Graphs the server returned for this source; a lower bound when `capped`. */
  graphCount: number;
  incompleteGraphs: number;
  /** Newest server-side timestamp for this source, or null. Never the client clock. */
  lastEvidenceAt: string | null;
  capped: boolean;
}

export type EvidenceSourcesResult =
  | { state: 'ok'; workspaceId: string; ingestEnabled: boolean; capped: boolean; sources: Record<ZevirSourceKind, EvidenceSourceStatus> }
  | { state: 'error'; workspaceId: string; status: number | null; code: string | null; message: string };

/** One page is enough to say "evidence exists"; counts at the cap are reported as lower bounds. */
export const EVIDENCE_LIST_LIMIT = 100;

const newest = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a);

/**
 * Pure mapping from server graphs to per-source status. A graph the server
 * returned counts as evidence even if the workspace flag was turned off later;
 * with no graphs, a disabled flag explains why rather than "setup required".
 */
export function summarizeEvidenceSources(graphs: readonly ZevirGraph[], ingestEnabled: boolean, capped = false): Record<ZevirSourceKind, EvidenceSourceStatus> {
  const out = {} as Record<ZevirSourceKind, EvidenceSourceStatus>;
  for (const kind of ZEVIR_SOURCE_KINDS) {
    const mine = graphs.filter((g) => g.source_kind === kind);
    const last = mine.reduce<string | null>((acc, g) => newest(acc, g.updated_at || g.capture_started_at || null), null);
    out[kind] = {
      sourceKind: kind,
      state: mine.length ? 'evidence_received' : ingestEnabled ? 'no_evidence' : 'ingest_disabled',
      graphCount: mine.length,
      incompleteGraphs: mine.filter((g) => g.status === 'incomplete').length,
      lastEvidenceAt: last,
      capped,
    };
  }
  return out;
}

type Request = <T>(path: string) => Promise<T>;

export async function loadEvidenceSources(workspaceId: string, ingestEnabled: boolean, request: Request = api): Promise<EvidenceSourcesResult> {
  try {
    const graphs = await request<ZevirGraph[]>(`/api/zevir/graphs?workspace_id=${encodeURIComponent(workspaceId)}&limit=${EVIDENCE_LIST_LIMIT}`);
    const list = Array.isArray(graphs) ? graphs : [];
    // A response for another workspace would be a server bug; never display it.
    const scoped = list.filter((g) => g.workspace_id === workspaceId);
    const capped = list.length >= EVIDENCE_LIST_LIMIT;
    return { state: 'ok', workspaceId, ingestEnabled, capped, sources: summarizeEvidenceSources(scoped, ingestEnabled, capped) };
  } catch (error) {
    if (error instanceof ApiClientError) return { state: 'error', workspaceId, status: error.status, code: error.code, message: error.message };
    return { state: 'error', workspaceId, status: null, code: null, message: error instanceof Error ? error.message : 'Could not load workspace evidence.' };
  }
}

export interface SourceBadge {
  label: string;
  tone: 'neutral' | 'info' | 'positive' | 'blocked';
}

/**
 * The only labels a catalogue card may show. "EVIDENCE RECEIVED" requires a
 * server-returned graph; nothing in this release can verify provider health.
 */
export function sourceBadge(availability: CapabilityAvailability, observed?: EvidenceSourceStatus | null): SourceBadge {
  if (availability === 'not_implemented') return { label: 'NOT AVAILABLE', tone: 'blocked' };
  if (observed?.state === 'evidence_received') return { label: 'EVIDENCE RECEIVED', tone: 'positive' };
  if (availability === 'flag_disabled' || observed?.state === 'ingest_disabled') return { label: 'NOT ENABLED FOR THIS WORKSPACE', tone: 'neutral' };
  if (availability === 'not_connected') return { label: 'NOT CONNECTED', tone: 'neutral' };
  if (availability === 'plan_restricted') return { label: 'PLAN RESTRICTED', tone: 'neutral' };
  if (availability === 'error') return { label: 'STATUS UNAVAILABLE', tone: 'blocked' };
  return { label: 'SETUP REQUIRED', tone: 'info' };
}
