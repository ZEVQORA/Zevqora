// @vitest-environment jsdom
/**
 * The ZevIR inspector inside the Project view: summary, counts by kind,
 * provenance, hash, schema version and node details — and unknown cost shown
 * as unknown, never as $0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/components/ui/Toast';
import { fixtureStore } from './fixtures/product-store';
import type { ZevirGraph, ZevirNode, ZevirProductView } from '../src/product/types';

let store: ReturnType<typeof fixtureStore>;
vi.mock('@/product/store', () => ({ useProduct: () => store }));
vi.mock('@/lib/session', () => ({
  useSession: () => ({ me: { user: { id: 'u', email: 'fixture@example.invalid' }, account: null, workspaces: [] }, activeWorkspace: { id: 'w', name: 'Fixture workspace', role: 'member', plan: 'free' } }),
}));
const { ZevirPanel } = await import('@/product/views/ZevirPanel');

const HASH = '9f'.repeat(32);
const graph: ZevirGraph = {
  id: 'g-1', workspace_id: 'w', product_id: 'prod-1', schema_version: 'zevir.v0.1', adapter_version: 'zevir-engine/0.1.0', source_kind: 'zevqora_engine', source_version: null,
  graph_key: 'engine:prod-1:req-7', source_trace_id: 'req-7', root_node_id: 'n-task', status: 'incomplete', node_count: 3, edge_count: 2, graph_hash: HASH,
  completeness: { gaps: [{ code: 'cost_unknown', count: 1 }] },
  summary: { node_counts: { Task: 1, ModelCall: 1, Runtime: 1 }, edge_counts: { CALLS: 1, SERVED_BY: 1 }, evidence_refs: 3, model_calls: 1, cost: { known: 0, unknown: 1, known_total_usd: null, complete: false }, tokens: { input_known: 1, input_total: 40, output_known: 1, output_total: 2 } },
  capture_started_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};
const call: ZevirNode = { id: 'n-call', stable_key: 'ab'.repeat(32), kind: 'ModelCall', name: 'openai/gpt-4o', operation: null, started_at: null, duration_ms: null, status: null, cost_usd: null, cost_source: null, latency_ms: 600, ttft_ms: null, input_tokens: 40, output_tokens: 2, cached_input_tokens: null, reasoning_tokens: null, attributes: { provider: 'openai' } };

function engine(view: Partial<ZevirProductView> = {}) {
  return {
    kind: 'cloud',
    zevir: vi.fn(async () => ({ enabled: true, shadow: true, product_id: 'prod-1', graphs: [graph], latest_run: { id: 'run', source_kind: 'zevqora_engine', status: 'succeeded', received_count: 1, accepted_count: 1, rejected_count: 0, error_code: null, error_detail: null, result: {}, started_at: '2026-09-01T00:00:00Z', completed_at: null }, ...view })),
    zevirBuild: vi.fn(async () => ({ reused: true, run: { result: {} } })),
    zevirNodes: vi.fn(async () => [call]),
    zevirNode: vi.fn(async () => ({ node: call, outgoing: [], incoming: [], evidence: [{ id: 'e1', node_id: 'n-call', source_kind: 'zevqora_engine', source_id: 'trace-row-uuid', source_trace_id: 'req-7', source_span_id: 'model_call', source_hash: 'cd'.repeat(32), adapter_version: 'zevir-engine/0.1.0', schema_version: 'zevir.v0.1', locator: {}, content_hash: 'ef'.repeat(32), redaction_state: 'hashed_only', captured_at: null }] })),
  };
}

const show = () => render(<ToastProvider><MemoryRouter><ZevirPanel /></MemoryRouter></ToastProvider>);

beforeEach(() => {
  store = fixtureStore({ engine: engine() });
});
afterEach(() => cleanup());

describe('ZevIR panel', () => {
  it('summarizes the graphs and keeps unknown cost unknown', async () => {
    show();
    expect(await screen.findByText('req-7')).toBeTruthy();
    expect(screen.getByText('0 of 1')).toBeTruthy();
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.000000')).toBeNull();
    expect(screen.getByText('INCOMPLETE')).toBeTruthy();
    expect(screen.getAllByText('ModelCall 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SERVED_BY 1').length).toBeGreaterThan(0);
  });

  it('shows hash, schema version, provenance and node details on selection', async () => {
    show();
    fireEvent.click(await screen.findByText('req-7'));
    expect(await screen.findByText(HASH)).toBeTruthy();
    expect(screen.getByText('zevir.v0.1 · zevir-engine/0.1.0')).toBeTruthy();
    expect(screen.getByText('cost_unknown ×1')).toBeTruthy();
    fireEvent.click(await screen.findByText('openai/gpt-4o'));
    await waitFor(() => expect(screen.getByText('trace-row-uuid')).toBeTruthy());
    expect(screen.getByText('cd'.repeat(32))).toBeTruthy();
    expect(screen.getByText(/not stored · sha256/)).toBeTruthy();
  });

  it('explains shadow mode is off and offers no build', async () => {
    store = fixtureStore({ engine: engine({ enabled: false, graphs: [], latest_run: null }) });
    show();
    expect(await screen.findByText(/Shadow mode is off/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Build graphs/ })).toBeNull();
  });

  it('says graphs are platform-only on the local engine, without calling it', () => {
    const local = { ...engine(), kind: 'local' };
    store = fixtureStore({ engine: local });
    show();
    expect(screen.getByText(/built by the platform engine/)).toBeTruthy();
    expect(local.zevir).not.toHaveBeenCalled();
  });
});
