// @vitest-environment jsdom
/**
 * Part 3 design system and Command Center. Claims are never colour-only,
 * unknown never renders as zero, charts never interpolate across missing
 * points, and presentation views change emphasis — not data or permissions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ClaimBadge, VerdictBadge } from '@/components/ui/Claim';
import { MetricCard } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/Segmented';
import { DataTable } from '@/components/ui/DataTable';
import { LineChart } from '@/components/charts/LineChart';
import { FunnelChart } from '@/components/charts/Bars';
import type { CommandCenter } from '@/product/experience';

configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });
afterEach(() => cleanup());

describe('design system', () => {
  it('claim and verdict badges carry a word and an icon, not only a colour', () => {
    render(<><ClaimBadge claim="PROJECTED" /><VerdictBadge verdict="REJECTED" /><VerdictBadge verdict={null} /></>);
    expect(screen.getByText('PROJECTED').querySelector('svg')).toBeTruthy();
    expect(screen.getByText('REJECTED').querySelector('svg')).toBeTruthy();
    expect(screen.getByText('NO VERDICT')).toBeTruthy();
  });

  it('a metric with no value says unknown, never $0, and links to its evidence', () => {
    render(<MemoryRouter><MetricCard label="Cost per successful outcome" value={null} claim="UNKNOWN" unknownReason="Needs a baseline." href="/app/optimize" /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /Cost per successful outcome: open the supporting evidence/ });
    expect(within(link).getByText('unknown')).toBeTruthy();
    expect(link.textContent).not.toMatch(/\$0/);
    expect(link.getAttribute('href')).toBe('/app/optimize');
  });

  it('segmented control is a radiogroup with arrow-key selection and one tab stop', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="View" value="cto" onChange={onChange} options={[{ value: 'ceo', label: 'CEO' }, { value: 'cto', label: 'CTO' }, { value: 'developer', label: 'Developer' }]} />);
    const group = screen.getByRole('radiogroup', { name: 'View' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    fireEvent.keyDown(radios[1], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('developer');
    fireEvent.keyDown(radios[1], { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('ceo');
  });

  it('data table sorts with aria-sort and keeps unknown values last in both directions', () => {
    const rows = [{ id: 'a', v: 3 }, { id: 'b', v: null }, { id: 'c', v: 7 }];
    render(<DataTable caption="Values" rows={rows} rowKey={(r) => r.id} columns={[{ key: 'id', header: 'Id', cell: (r) => r.id }, { key: 'v', header: 'Value', sort: (r) => r.v, cell: (r) => (r.v === null ? 'unknown' : r.v) }]} />);
    const header = screen.getByRole('columnheader', { name: /Value/ });
    fireEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('descending');
    const order = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(order()).toEqual(['c7', 'a3', 'bunknown']);
    fireEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(order()).toEqual(['a3', 'c7', 'bunknown']);
  });

  it('a line chart splits the line at a missing point instead of interpolating', () => {
    const { container } = render(<LineChart ariaLabel="Spend" labels={['1', '2', '3', '4']} format={(v) => String(v)} series={[{ key: 's', label: 'Spend', color: 'blue', values: [1, 2, null, 4] }]} />);
    const d = container.querySelector('path')!.getAttribute('d')!;
    const segments = d.split('M').filter(Boolean).map((seg) => seg.trim().split('L').length);
    // Points 1–2 form one segment; point 4 starts a new one. Nothing joins 2 to 4.
    expect(segments).toEqual([2, 1]);
    // The isolated last point is also drawn as a dot so it stays visible.
    expect(container.querySelectorAll('circle').length).toBe(1);
  });

  it('a funnel with an unknown step says unknown and does not compute a conversion from it', () => {
    render(<FunnelChart ariaLabel="Funnel" steps={[{ key: 'a', label: 'Visitors', value: null }, { key: 'b', label: 'Signup', value: 4 }]} />);
    expect(screen.getByText('unknown')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

// ------------------------------------------------------------------ Command Center
const CC: CommandCenter = {
  workspace_id: 'w', role: 'viewer', generated_at: '2026-10-12T00:00:00Z', range: { from: '2026-09-12T00:00:00Z', to: '2026-10-12T00:00:00Z', days: 30 }, synthetic: true,
  observed: { claim: 'OBSERVED', source: 'engine_traces', window: { from: '', to: '' }, truncated: false, trace_limit: 5000, requests: 32, spend_usd: 0.1111, cost_known: 31, cost_coverage: 0.97, latency: { p50_ms: 1500, p95_ms: 2124, p99_ms: null, samples: 32, p99_note: 'p99 needs at least 100 timed requests' }, ttft: { p50_ms: null, p95_ms: null, samples: 0 }, retries: 2, daily: [{ day: '2026-09-01', requests: 32, spend_usd: 0.1111, cost_known: 31, p50_ms: 1500, p95_ms: 2124, samples: 32 }], by_model: [{ provider: 'openai', model: 'gpt-4o', requests: 32, spend_usd: 0.1111, cost_known: 31, p50_ms: 1500, p95_ms: 2124, samples: 32 }], by_workflow: [] },
  products: [{
    id: 'p1', name: 'Support triage (SYNTHETIC DEMO — NOT CUSTOMER DATA)', synthetic: true, traces_in_window: 32, last_trace_at: null,
    contract: { id: 'c', version: 1, frozen_at: '', contract_hash: 'c'.repeat(64) }, run: { id: 'r', status: 'open', created_at: '' },
    baseline: { claim: 'OBSERVED', snapshot_id: 's', snapshot_hash: 'f'.repeat(64), contract_hash: 'c'.repeat(64), created_at: '2026-10-01T00:00:00Z', trace_count: 32, completeness: 'complete', window_truncated: false, spend_usd: 0.1111, cost_coverage: 1, cpso_usd: 0.003967, cpso_unavailable: [], p50_ms: 1500, p95_ms: 2268, p99_ms: null, ttft_p95_ms: null, task_success: 0.9667, task_success_known: 30, quality: 1, failure_rate: 0, retry_rate: 0.07, retry_amplification: 1.07, retry_latency_ms: 700, protected: { requests: 2, outcome_known: 2, failed: 0 }, logical_requests: 30, missing_evidence: [], hotspots: [], critical_path: { status: 'unavailable', complete_graphs: 0, graphs: 0, incomplete_reasons: ['no complete timing'] } },
    diagnoses: { count: 1, top: [{ id: 'd1', family: 'redundant_call', severity: 'high', symptom: '12 repeated calls', scope: 'classify', confidence: 0.9, affected_nodes: 12 }] },
    search: { id: 'se', status: 'completed', created_at: '', completed_at: '', generated: 58, blocked: 30, verified: 3, rejected: 3, incomplete: 0, frontier: 3 },
    decision: { id: 'de', policy: 'MARGIN_FIRST', outcome: 'SELECTED', created_at: '', selected_plan: { id: 'pl', name: 'Validated lookup', plan_hash: 'a'.repeat(64), risk_class: 'high', implementation_complexity: 4, rollback_complexity: 2, claim: 'EVALUATED', verdict: 'VERIFIED', cases: 29, cpso_usd: 0.0016, cost_usd: 0.045, p95_ms: 2124, task_success: 0.9655, quality: 1, baseline: { cpso_usd: 0.003967, cost_usd: 0.1111, p95_ms: 2124, task_success: 0.9655, quality: 1 }, deltas_pct: { cost_per_successful_outcome: -59.2, cost: -59.2, p95: 0 } } },
    projected: { claim: 'PROJECTED', monthly_cost_change_usd: null, unavailable_reason: 'No requests were observed in the last 30 days to project onto.', basis: { formula: 'f', assumptions: ['a'] } },
  }],
  pipeline: { workloads: 1, with_traces: 1, frozen_contracts: 1, baselines: 1, diagnoses: 7, searches: 1, plans_generated: 58, calibrated: 12, replayed: 5, verified: 3, rejected: 3, incomplete: 0, frontier: 3, selected: 1, blocked: 30 },
  verdicts: { claim: 'EVALUATED', VERIFIED: 3, REJECTED: 2, INCOMPLETE: 0, total: 5 },
  value: { evaluated: [], projected: { claim: 'PROJECTED', monthly_cost_change_usd: null, plans: 1 }, realized: { claim: 'REALIZED', status: 'NOT_YET_MEASURED', reason: 'ZEVQORA does not measure production after a change ships yet.' } },
  decision_queue: [{ kind: 'review_selected', product_id: 'p1', product: 'Support triage', priority: 1, title: 'Review "Validated lookup" for shipping', detail: 'VERIFIED on replay. Not deployed.', href: '/app/optimize' }],
  risks: [],
};
CC.value.evaluated = [{ ...CC.products[0].decision!.selected_plan!, product_id: 'p1', product: 'Support triage', policy: 'MARGIN_FIRST', projected: CC.products[0].projected }];

const api = { commandCenter: vi.fn() };
vi.mock('@/product/experience', async (orig) => ({ ...(await orig<typeof import('@/product/experience')>()), experienceApi: new Proxy({}, { get: (_t, k: string) => (api as Record<string, unknown>)[k] }) }));
vi.mock('@/product/store', () => ({ useProduct: () => ({ selectProduct: vi.fn() }) }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ activeWorkspace: { id: 'w', name: 'W', role: 'viewer', plan: 'free', features: {} } }) }));
const { default: CommandCenterView } = await import('@/product/command/CommandCenterView');
const { PresentationModeProvider } = await import('@/lib/mode');
const show = () => render(<MemoryRouter><PresentationModeProvider><CommandCenterView /></PresentationModeProvider></MemoryRouter>);

describe('Command Center', () => {
  beforeEach(() => {
    localStorage.clear();
    api.commandCenter.mockReset().mockResolvedValue(structuredClone(CC));
  });

  it('CEO view keeps evaluated, projected and realized apart; realized is NOT YET MEASURED', async () => {
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'CEO' }));
    expect(await screen.findByText('Evaluated improvement')).toBeTruthy();
    expect(screen.getByText('Projected impact')).toBeTruthy();
    expect(screen.getByText('Realized production value')).toBeTruthy();
    expect(screen.getAllByText('NOT YET MEASURED').length).toBeGreaterThan(0);
    expect(screen.getByText(/SYNTHETIC DEMO — NOT CUSTOMER DATA\./)).toBeTruthy();
    expect(screen.getByText(/Review "Validated lookup" for shipping/)).toBeTruthy();
  });

  it('switching views changes emphasis but not the data request or permissions', async () => {
    show();
    await screen.findByText('Workload comparison');
    fireEvent.click(screen.getByRole('radio', { name: 'Developer' }));
    expect(await screen.findByText('Workloads and provenance')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'CEO' }));
    await screen.findByText('Evaluated improvement');
    // One request per range; the view never asks the API for anything different.
    expect(api.commandCenter).toHaveBeenCalledTimes(1);
    expect(api.commandCenter).toHaveBeenCalledWith('w', 30);
    expect(screen.getByText(/your workspace role decides what you can see and do/)).toBeTruthy();
  });

  it('shows p99 as unknown with its reason instead of a number', async () => {
    show();
    const card = (await screen.findByText('p99 latency')).closest('div.group, div.flex') as HTMLElement;
    expect(within(card.parentElement as HTMLElement).getByText('unknown')).toBeTruthy();
  });

  it('an empty workspace gets the connect-evidence state with Zev, not zeros', async () => {
    api.commandCenter.mockResolvedValue({ ...structuredClone(CC), products: [], synthetic: false });
    show();
    expect(await screen.findByText('Connect your first AI workload')).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('an API failure is shown with a retry, never as an empty dashboard', async () => {
    api.commandCenter.mockRejectedValue(new Error('Workspace not found.'));
    show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });
});

describe('cookieless analytics client', () => {
  it('sends nothing when Do Not Track or GPC is on, and never tracks product or admin paths', async () => {
    const { analyticsOptedOut, isWebsitePath } = await import('@/lib/analytics');
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    expect(analyticsOptedOut()).toBe(true);
    Object.defineProperty(navigator, 'doNotTrack', { value: '0', configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    expect(analyticsOptedOut()).toBe(true);
    expect(isWebsitePath('/')).toBe(true);
    expect(isWebsitePath('/evaluation')).toBe(true);
    expect(isWebsitePath('/app/graph')).toBe(false);
    expect(isWebsitePath('/admin/security')).toBe(false);
    expect(isWebsitePath('/invite/abc')).toBe(false);
    expect(isWebsitePath('/reset-password')).toBe(false);
  });
});
