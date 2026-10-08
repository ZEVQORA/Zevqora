// @vitest-environment jsdom
/**
 * Optimization Intelligence UI (vNext Part 2B). The fixture is a real report
 * captured from the synthetic v2 demo flow (SYNTHETIC DEMO — NOT CUSTOMER
 * DATA), trimmed to a representative set of plans; it contains ids, hashes
 * and metrics only. The view keeps every claim label honest: estimates are
 * ESTIMATED, calibration is never VERIFIED, unknown is never $0, production
 * results are NOT YET MEASURED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/components/ui/Toast';
import { fixtureStore, FIXTURE_PRODUCT } from './fixtures/product-store';
import fixture from './fixtures/plan-search-report.json';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let store: ReturnType<typeof fixtureStore>;
vi.mock('@/product/store', () => ({ useProduct: () => store }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ me: { user: { id: 'u', email: 'fixture@example.invalid' }, workspaces: [] }, activeWorkspace: { id: 'w', name: 'W', role: 'owner', plan: 'free', features: { verified_optimization_vnext: true, optimization_intelligence_vnext: true } } }) }));

const api = { status: vi.fn(), report: vi.fn(), searches: vi.fn(), searchReport: vi.fn(), startSearch: vi.fn() };
vi.mock('@/product/optimize', () => ({ optimizeApi: new Proxy({}, { get: (_t, k: string) => (api as Row)[k] }) }));
const { default: OptimizeView } = await import('@/product/views/OptimizeView');
const show = () => render(<ToastProvider><MemoryRouter><OptimizeView /></MemoryRouter></ToastProvider>);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
// A large fixture renders slowly when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  store = fixtureStore({ engine: { kind: 'cloud' }, selected: { ...FIXTURE_PRODUCT, name: (fixture as Row).report.plans.length ? 'Support triage + refund agent (SYNTHETIC DEMO — NOT CUSTOMER DATA)' : 'x' } });
  api.status.mockResolvedValue((fixture as Row).status);
  api.report.mockResolvedValue((fixture as Row).runReport);
  api.searches.mockResolvedValue((fixture as Row).searches);
  api.searchReport.mockResolvedValue(clone((fixture as Row).report));
});
afterEach(() => cleanup());

describe('Optimization Intelligence view', () => {
  it('shows the plan search with counts, stages and ESTIMATED effects; blocked plans say why', async () => {
    show();
    const counts = (fixture as Row).report.counts;
    expect((await screen.findByText('Generated')).nextSibling?.textContent).toBe(String(counts.generated));
    expect(screen.getByText(/effects are/).textContent).toMatch(/ESTIMATED/);
    expect(screen.getAllByText('NEEDS IMPLEMENTATION').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Conflicted').length).toBeGreaterThan(0);
    expect(screen.getByText(/SYNTHETIC DEMO — NOT CUSTOMER DATA\. Every number/)).toBeTruthy();
  });

  it('expands a plan into its full explanation', async () => {
    show();
    const btn = (await screen.findAllByRole('button', { name: /Show details for/ }))[0];
    const step = btn.closest('section') as HTMLElement;
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(within(step).getByText('Passes composed (in order)')).toBeTruthy();
    expect(within(step).getByText('What could falsify it')).toBeTruthy();
    expect(within(step).getByText('Not proven')).toBeTruthy();
  });

  it('labels calibration CALIBRATED and never VERIFIED', async () => {
    show();
    const step = (await screen.findByText('Calibration')).closest('section') as HTMLElement;
    const table = within(step).getByRole('table');
    expect(within(table).getAllByText('CALIBRATED').length).toBeGreaterThan(0);
    expect(within(table).queryByText('VERIFIED')).toBeNull();
    expect(within(step).getByText(/CALIBRATION — NOT VERIFIED/)).toBeTruthy();
  });

  it('highlights the Pareto frontier among VERIFIED plans and draws an accessible scatter', async () => {
    show();
    const step = (await screen.findByText('Pareto frontier')).closest('section') as HTMLElement;
    expect(within(step).getAllByText('FRONTIER').length).toBe((fixture as Row).report.counts.frontier);
    expect(within(step).getByRole('img', { name: /on the frontier/ })).toBeTruthy();
  });

  it('shows unknown, never $0, when a verified metric is unknown', async () => {
    const r = clone((fixture as Row).report);
    const p = r.plans.find((x: Row) => x.verdict === 'VERIFIED');
    p.verified_effects.cpso_usd = null;
    p.frontier_state = 'INCOMPARABLE';
    api.searchReport.mockResolvedValue(r);
    show();
    const step = (await screen.findByText('Pareto frontier')).closest('section') as HTMLElement;
    const row = within(step).getByText(p.name).closest('tr') as HTMLElement;
    expect(within(row).getByText('unknown')).toBeTruthy();
    expect(within(row).queryByText(/\$0\.0+$/)).toBeNull();
  });

  it('explains the selected plan, its Bad-Day Replay, and that production is NOT YET MEASURED', async () => {
    show();
    const step = (await screen.findByText('Selected plan')).closest('section') as HTMLElement;
    expect(within(step).getByText('Why selected')).toBeTruthy();
    expect(within(step).getAllByText('NOT YET MEASURED').length).toBeGreaterThan(0);
    expect(within(step).getAllByText('BAD-DAY REPLAY').length).toBeGreaterThan(0);
    expect(within(step).getByText(/Simulation\/replay result ≠ production guarantee/)).toBeTruthy();
    expect(within(step).getByRole('radiogroup', { name: 'Decision policy' })).toBeTruthy();
    expect(within(step).getByText('What is NOT proven')).toBeTruthy();
  });

  it('offers to start a search when none exists, and hides actions from read-only users', async () => {
    api.searches.mockResolvedValue({ searches: [] });
    show();
    expect(await screen.findByRole('button', { name: /Start plan search/ })).toBeTruthy();
    cleanup();
    store = fixtureStore({ engine: { kind: 'cloud' }, canEdit: false, selected: { ...FIXTURE_PRODUCT, name: 'x (SYNTHETIC DEMO — NOT CUSTOMER DATA)' } });
    show();
    await screen.findByText('Plan search');
    expect(screen.queryByRole('button', { name: /Start plan search/ })).toBeNull();
  });

  it('switches the report between Executive and Developer views', async () => {
    show();
    const step = (await screen.findByText('Optimization Intelligence report')).closest('section') as HTMLElement;
    expect(within(step).getByText(/plans generated · /)).toBeTruthy();
    fireEvent.click(within(step).getByRole('radio', { name: 'Developer' }));
    expect(within(step).getAllByText('Composition order').length).toBeGreaterThan(0);
  });
});
