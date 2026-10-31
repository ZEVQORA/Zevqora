// @vitest-environment jsdom
/**
 * Integration guards for the unified vNext + ZevIR frontend: the typed
 * evidence-source gateway, the role mirror against real handler source, and
 * the public/private boundary of the public Zev support panel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import axe from 'axe-core';
import { ApiClientError } from '@/lib/api';
import type { ZevirGraph } from '@/product/types';
import type { CapabilityAvailability } from '@/lib/contracts/claims';

configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 60_000 });
afterEach(() => cleanup());

const session = vi.hoisted(() => ({ current: { status: 'signed_in', activeWorkspace: { id: 'ws-a', name: 'Workspace A', role: 'viewer', plan: 'free', features: { zevir_shadow: true } as Record<string, boolean> } } }));
vi.mock('@/lib/session', () => ({ useSession: () => session.current }));
vi.mock('@/lib/supabase', () => ({ getSupabase: async () => null, supabaseSync: () => null, accessToken: async () => null }));
const apiMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: (...args: unknown[]) => apiMock.fn(...args) }));

const { loadEvidenceSources, summarizeEvidenceSources, sourceBadge, ZEVIR_SOURCE_KINDS, EVIDENCE_LIST_LIMIT } = await import('@/lib/clients/evidence-sources');
const { SERVER_ACTIONS, roleAllows } = await import('@/lib/contracts/roles');
const { SETUP_CATALOG } = await import('@/lib/clients/integrations');

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

function graph(over: Partial<ZevirGraph>): ZevirGraph {
  return {
    id: 'g', workspace_id: 'ws-a', product_id: null, schema_version: '0.1', adapter_version: '1', source_kind: 'otel_genai', source_version: null,
    graph_key: 'k', source_trace_id: null, root_node_id: null, status: 'complete', node_count: 1, edge_count: 0, graph_hash: 'h',
    completeness: { gaps: [] }, summary: { node_counts: {}, edge_counts: {}, evidence_refs: 0, model_calls: 0, cost: { known: 0, unknown: 0, known_total_usd: null, complete: false }, tokens: { input_known: 0, input_total: null, output_known: 0, output_total: null } },
    capture_started_at: null, updated_at: '2026-10-30T10:00:00Z', ...over,
  };
}

async function violations(container: HTMLElement) {
  const res = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } });
  return res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

describe('role mirror matches the handlers', () => {
  it.each(SERVER_ACTIONS.map((a) => [a.key, a] as const))('%s', (_key, action) => {
    const src = read(`api/_lib/handlers/${action.handler}`);
    const start = src.indexOf(`on('${action.method}', '${action.path}'`);
    expect(start, `${action.method} ${action.path} registered in ${action.handler}`).toBeGreaterThanOrEqual(0);
    const next = src.indexOf('\non(', start + 1);
    const block = src.slice(start, next === -1 ? undefined : next);
    const role = block.match(/'(viewer|member|admin|owner)'/)?.[1];
    expect(role).toBe(action.minRole);
  });

  it('ranks roles like api/_lib/auth.js and denies unknown roles', () => {
    expect(read('api/_lib/auth.js')).toContain('const ROLE_RANK = { owner: 4, admin: 3, member: 2, viewer: 1 };');
    expect(roleAllows('viewer', 'member')).toBe(false);
    expect(roleAllows('member', 'member')).toBe(true);
    expect(roleAllows('owner', 'admin')).toBe(true);
    expect(roleAllows(null, 'viewer')).toBe(false);
    expect(roleAllows('ceo' as never, 'viewer')).toBe(false);
  });
});

describe('evidence-source gateway', () => {
  it('keeps unknown timestamps unknown and separates flag-off from setup-required', () => {
    const off = summarizeEvidenceSources([], false);
    expect(Object.values(off).every((s) => s.state === 'ingest_disabled' && s.lastEvidenceAt === null && s.graphCount === 0)).toBe(true);
    const on = summarizeEvidenceSources([], true);
    expect(on.otel_genai.state).toBe('no_evidence');
    const seen = summarizeEvidenceSources([graph({ updated_at: '', capture_started_at: null })], false);
    expect(seen.otel_genai).toMatchObject({ state: 'evidence_received', graphCount: 1, lastEvidenceAt: null });
  });

  it('reports the newest server timestamp and incomplete graphs per source', () => {
    const s = summarizeEvidenceSources([
      graph({ id: '1', updated_at: '2026-10-01T00:00:00Z' }),
      graph({ id: '2', updated_at: '2026-10-29T00:00:00Z', status: 'incomplete' }),
      graph({ id: '3', source_kind: 'openinference', updated_at: '2026-09-01T00:00:00Z' }),
    ], true);
    expect(s.otel_genai).toMatchObject({ graphCount: 2, incompleteGraphs: 1, lastEvidenceAt: '2026-10-29T00:00:00Z' });
    expect(s.openinference.graphCount).toBe(1);
    expect(s.zevqora_engine.state).toBe('no_evidence');
  });

  it('calls only the existing workspace-scoped graph list and drops rows from another workspace', async () => {
    const request = vi.fn().mockResolvedValue([graph({ workspace_id: 'ws-b' }), graph({ id: 'mine' })]);
    const out = await loadEvidenceSources('ws-a', true, request);
    expect(request).toHaveBeenCalledWith(`/api/zevir/graphs?workspace_id=ws-a&limit=${EVIDENCE_LIST_LIMIT}`);
    expect(out.state === 'ok' && out.sources.otel_genai.graphCount).toBe(1);
  });

  it('marks counts as lower bounds at the page cap', async () => {
    const page = Array.from({ length: EVIDENCE_LIST_LIMIT }, (_, i) => graph({ id: String(i) }));
    const out = await loadEvidenceSources('ws-a', true, vi.fn().mockResolvedValue(page));
    expect(out.state === 'ok' && out.capped && out.sources.otel_genai.capped).toBe(true);
  });

  it('returns the server error code instead of an empty success', async () => {
    const out = await loadEvidenceSources('ws-a', true, vi.fn().mockRejectedValue(new ApiClientError(404, 'Workspace not found.', 'NOT_FOUND')));
    expect(out).toMatchObject({ state: 'error', status: 404, code: 'NOT_FOUND' });
    const offline = await loadEvidenceSources('ws-a', true, vi.fn().mockRejectedValue(new ApiClientError(0, 'Offline', 'OFFLINE')));
    expect(offline).toMatchObject({ state: 'error', code: 'OFFLINE' });
  });

  it('never labels anything CONNECTED or HEALTHY', () => {
    const avail: CapabilityAvailability[] = ['available', 'setup_required', 'flag_disabled', 'plan_restricted', 'not_connected', 'not_implemented', 'error'];
    const observed = [null, ...ZEVIR_SOURCE_KINDS.flatMap((k) => (['evidence_received', 'no_evidence', 'ingest_disabled'] as const).map((state) => ({ sourceKind: k, state, graphCount: 1, incompleteGraphs: 0, lastEvidenceAt: null, capped: false })))];
    for (const a of avail) for (const o of observed) expect(sourceBadge(a, o).label).not.toMatch(/^(CONNECTED|HEALTHY|ACTIVE)|HEALTHY/);
    expect(sourceBadge('not_implemented', observed[1]).label).toBe('NOT AVAILABLE');
  });

  it('catalogue claims no live connection and binds only real ZevIR source kinds', () => {
    expect(SETUP_CATALOG.every((e) => e.availability !== 'available')).toBe(true);
    for (const e of SETUP_CATALOG) if (e.zevirSource) expect(ZEVIR_SOURCE_KINDS).toContain(e.zevirSource);
    expect(read('api/_lib/zevir/contracts.js')).toContain("SOURCE_KINDS = Object.freeze(['zevqora_engine', 'otel_genai', 'openinference'])");
  });
});

describe('IntegrationCatalog', () => {
  // Braces matter: a function returned from beforeEach is run as teardown, which would call the mock again.
  beforeEach(() => { apiMock.fn.mockReset(); });

  it('upgrades a card only from server evidence and stays accessible', async () => {
    apiMock.fn.mockResolvedValue([graph({ id: 'x', source_kind: 'otel_genai' })]);
    const { default: IntegrationCatalog } = await import('@/product/views/IntegrationCatalog');
    const { container } = render(<MemoryRouter><main><IntegrationCatalog /></main></MemoryRouter>);
    const otel = (await screen.findByRole('heading', { name: 'OpenTelemetry GenAI' })).closest('article')!;
    await screen.findByText(/Workspace evidence from the server/);
    expect(otel.textContent).toContain('EVIDENCE RECEIVED');
    expect(screen.getByRole('heading', { name: 'OpenInference' }).closest('article')!.textContent).toContain('SETUP REQUIRED');
    expect(container.textContent).not.toMatch(/\bHEALTHY\b|\bCONNECTED ·|ACTIVE CONNECTION/);
    expect(await violations(container)).toEqual([]);
  });

  it('shows the server error with a retry instead of pretending', async () => {
    apiMock.fn.mockRejectedValue(new ApiClientError(500, 'Request failed (500).', 'INTERNAL'));
    const { default: IntegrationCatalog } = await import('@/product/views/IntegrationCatalog');
    render(<MemoryRouter><IntegrationCatalog /></MemoryRouter>);
    const status = await screen.findByText(/Workspace evidence could not be loaded/);
    expect(status.textContent).toContain('Request failed (500). (INTERNAL)');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('EVIDENCE RECEIVED')).toBeNull();
  });
});

describe('EnterpriseView', () => {
  it('shows the verified role, denies admin actions to a viewer and sends nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    session.current = { ...session.current, activeWorkspace: { ...session.current.activeWorkspace, role: 'viewer', features: {} } };
    const { default: EnterpriseView } = await import('@/product/views/EnterpriseView');
    const { container } = render(<MemoryRouter><main><EnterpriseView /></main></MemoryRouter>);
    expect(screen.getByText('Your role (server-verified)').nextElementSibling?.textContent).toBe('viewer');
    const freeze = screen.getByText('Freeze evaluation gates').closest('tr')!;
    expect(freeze.textContent).toContain('Not with your role');
    expect(screen.queryByRole('link', { name: /Email the enterprise team/ })).toBeNull();
    expect(screen.getByText(/flag off/)).toBeTruthy();
    expect(container.querySelectorAll('main').length).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await violations(container)).toEqual([]);
    fetchSpy.mockRestore();
  });
});

describe('public Zev support', () => {
  it('is FAQ-only: no network, no private agent route, focus returns on Escape', async () => {
    const src = read('src/marketing/SupportZevLauncher.tsx');
    expect(src).not.toMatch(/\/api\/|fetch\(|engine\/agent|useProduct|experienceApi/);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { SupportZevLauncher } = await import('@/marketing/SupportZevLauncher');
    const { container } = render(<MemoryRouter><main><SupportZevLauncher /></main></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: 'Open Ask Zev public support' });
    act(() => trigger.click());
    const dialog = screen.getByRole('dialog', { name: /Ask Zev — ZEVQORA Support/ });
    expect(dialog.textContent).toContain('Not a live agent');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close support');
    expect(await violations(container)).toEqual([]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Open Ask Zev public support');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('routing and public claims', () => {
  it('retires public /demo but keeps the internal synthetic engine demo endpoint', () => {
    expect(read('src/App.tsx')).toContain('<Route path="demo/*" element={<Navigate to="/product" replace />} />');
    expect(read('api/_lib/handlers/optimize.js')).toContain("on('POST', '/api/optimize/demo'");
    expect(read('public/sitemap.xml')).not.toContain('/demo');
  });

  it('keeps all three founders on the public Team page', () => {
    const team = read('src/marketing/TeamPage.tsx');
    for (const name of ['Bayarbayasgalan Enkhtulga', 'Khuslen Ganbat', 'Bat-Ochir']) expect(team).toContain(name);
  });

  it('reference prices never reach checkout', () => {
    const fallback = read('src/marketing/PricingReferenceFallback.tsx');
    expect(fallback).not.toMatch(/stripe|create-checkout|navigate\(/i);
    expect(fallback).toContain('reference');
  });
});
