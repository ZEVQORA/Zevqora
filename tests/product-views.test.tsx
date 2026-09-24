// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/components/ui/Toast';
import { fixtureStore, ECONOMICS_PARTIAL, VERIFIED, REJECTED_CHEAPER, INCOMPLETE } from './fixtures/product-store';

let store: ReturnType<typeof fixtureStore>;
vi.mock('@/product/store', () => ({ useProduct: () => store }));
vi.mock('@/lib/session', () => ({
  useSession: () => ({ me: { user: { id: 'u', email: 'fixture@example.invalid' }, account: null, workspaces: [] }, activeWorkspace: { id: 'w', name: 'Fixture workspace', role: 'member', plan: 'free' } }),
}));

const { default: EvidenceView } = await import('@/product/views/EvidenceView');
const { default: SavingsView } = await import('@/product/views/SavingsView');
const { default: OverviewView } = await import('@/product/views/OverviewView');
const { default: ConnectionsView } = await import('@/product/views/ConnectionsView');

const show = (el: React.ReactElement) => render(<ToastProvider><MemoryRouter>{el}</MemoryRouter></ToastProvider>);

beforeEach(() => {
  store = fixtureStore();
});
afterEach(() => cleanup());

describe('Evidence view', () => {
  it('INCOMPLETE lists the exact evidence still required', () => {
    store = fixtureStore({ inspect: { kind: 'evaluation', id: INCOMPLETE.id } });
    show(<EvidenceView />);
    expect(screen.getByText('Not enough evidence to decide: Cost improvement.')).toBeTruthy();
    expect(screen.getByText('Evidence still required')).toBeTruthy();
    expect(screen.getByText('Baseline cost is unknown on 4 of 12 cases. Re-import those traces with cost_usd.')).toBeTruthy();
  });

  it('a cheaper REJECTED candidate shows the failed gate and is never savings', () => {
    store = fixtureStore({ inspect: { kind: 'evaluation', id: REJECTED_CHEAPER.id } });
    show(<EvidenceView />);
    expect(screen.getByText('Rejected by Quality floor.')).toBeTruthy();
    expect(screen.getByText(/never counted as savings/)).toBeTruthy();
  });

  it('VERIFIED lists every gate that passed', () => {
    store = fixtureStore({ inspect: { kind: 'evaluation', id: VERIFIED.id } });
    show(<EvidenceView />);
    expect(screen.getByText('All 4 required gates passed.')).toBeTruthy();
    expect(screen.getByText('✓ Minimum samples')).toBeTruthy();
  });
});

describe('Savings view', () => {
  it('counts only the verified line and keeps projected and realized separate', () => {
    show(<SavingsView />);
    expect(screen.getByText('A · Measured on evaluated cases')).toBeTruthy();
    expect(screen.getByText('Not modelled')).toBeTruthy();
    expect(screen.getByText('No evidence yet')).toBeTruthy();
    expect(screen.getByText(/1 rejected · 1 incomplete/)).toBeTruthy();
    const ledger = screen.getByRole('table');
    expect(within(ledger).getByText('Rejected: not savings')).toBeTruthy();
    expect(within(ledger).getByText('Incomplete: not savings')).toBeTruthy();
  });

  it('shows unknown as a dash, never $0, when nothing is verified', () => {
    store = fixtureStore({ evaluations: [REJECTED_CHEAPER] });
    show(<SavingsView />);
    expect(screen.getByText('Nothing verified yet. Unknown is shown as —, never as $0.')).toBeTruthy();
    expect(screen.queryByText('$0.000000')).toBeNull();
  });
});

describe('Overview baseline render', () => {
  it('labels a partially priced cost total as a lower bound and names the gap', () => {
    show(<OverviewView />);
    expect(screen.getByText(/^≥ /)).toBeTruthy();
    expect(screen.getByText('8 of 12 traces priced · total is a lower bound')).toBeTruthy();
    expect(screen.getByText('1 gap')).toBeTruthy();
  });

  it('reports the latest verified impact as measured on evaluated cases', () => {
    show(<OverviewView />);
    expect(screen.getByText('lower cost on 12 evaluated cases · measured, not projected')).toBeTruthy();
  });

  it('shows an unknown cost signal as a dash when no trace is priced', () => {
    store = fixtureStore({ economics: { ...ECONOMICS_PARTIAL, observed_cost_usd: null, baseline: { ...ECONOMICS_PARTIAL.baseline!, cost: { known: 0, unknown: 12, complete: false, sources: {} } } } });
    show(<OverviewView />);
    expect(screen.getByText('0 of 12 traces priced · total is a lower bound')).toBeTruthy();
  });
});

describe('Permission denial', () => {
  it('viewers see a view-only notice and no import or scan actions', () => {
    store = fixtureStore({ canEdit: false });
    show(<ConnectionsView />);
    expect(screen.getByText('View only.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Import traces/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Scan/ })).toBeNull();
  });
});
