// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const setActiveWorkspaceId = vi.fn();
const refreshMe = vi.fn(async () => null);
let workspaces: Array<{ id: string; name: string; role: string }> = [];
vi.mock('@/lib/session', () => ({
  useSession: () => ({ me: { user: { id: 'u' }, workspaces }, refreshMe, setActiveWorkspaceId, activeWorkspace: workspaces[0] || null }),
}));

const createWorkspace = vi.fn(async (name: string) => ({ workspace: { id: 'ws-new', name } }));
const updateMe = vi.fn(async () => ({}));
vi.mock('@/app/data', () => ({ app: { createWorkspace: (n: string) => createWorkspace(n), updateMe: (b: unknown) => updateMe(b) } }));

const engine = {
  createWorkload: vi.fn(async (input: { name: string }) => ({ id: 'prod-w', name: input.name, root_path: 'workload://x' })),
  setTrial: vi.fn(async () => ({})),
  importTraces: vi.fn(async () => ({ imported: 12, rejected: 0, errors: [] as string[] })),
  findings: vi.fn(async () => [] as unknown[]),
  economics: vi.fn(async () => ({ trace_count: 12 })),
};
vi.mock('@/product/engine', () => ({ cloudEngine: () => engine, localEngine: () => engine, engineErrorMessage: (e: unknown) => String((e as Error)?.message || e) }));
vi.mock('@/product/bridge', () => ({ isDesktop: () => false, desktopBridge: () => null }));
vi.mock('@/product/browserScan', () => ({ pickRepository: vi.fn(async () => null), pickTraceFile: vi.fn(async () => ({ name: 'support.jsonl', content: '{"request_id":"r1"}' })) }));
vi.mock('@/product/store', () => ({ rememberSelectedProduct: vi.fn() }));

const { default: OnboardingPage } = await import('@/app/pages/OnboardingPage');

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/onboarding?intent=evaluation']}>
      <Routes>
        <Route path="/app/onboarding" element={<OnboardingPage />} />
        <Route path="/app" element={<p>app overview</p>} />
        <Route path="/app/connections" element={<p>connections</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function walkToFirstAnalysis() {
  fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Acme AI' } });
  fireEvent.click(screen.getByRole('button', { name: /Create workspace/ }));
  await screen.findByText('What can ZEVQORA look at?');
  fireEvent.click(screen.getByRole('button', { name: /A workload’s traces/ }));
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByText('Confirm what leaves your machine.');
  const cont = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement;
  expect(cont.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I am authorized to share this evidence/));
  expect(cont.disabled).toBe(false);
  fireEvent.click(cont);
  await screen.findByText('What must a cheaper change still do?');
  fireEvent.change(screen.getByLabelText('Quality floor (0.5 – 1)'), { target: { value: '0.97' } });
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByText('Pick the trace file.');
  fireEvent.click(screen.getByRole('button', { name: /Choose trace file/ }));
}

beforeEach(() => {
  workspaces = [];
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('onboarding', () => {
  it('reaches first evidence and shows the first supported opportunity', async () => {
    engine.findings.mockResolvedValueOnce([
      { id: 'f1', category: 'context_review', origin: 'runtime_evidence', title: 'Long context', root_cause: '…', confidence: 0.9 },
      { id: 'f2', category: 'repeated_execution', origin: 'runtime_evidence', title: 'Same request answered 5 times', root_cause: 'Identical inputs.', confidence: 0.8 },
    ]);
    renderPage();
    await walkToFirstAnalysis();
    await screen.findByText(/^First evidence in /);
    expect(screen.getByText('Same request answered 5 times')).toBeTruthy();
    expect(screen.getByText('Exact reuse · ready to test on your traces')).toBeTruthy();
    expect(engine.createWorkload).toHaveBeenCalledWith({ name: 'support', requirements: { quality_floor: 0.97, min_samples: 10, require_protected_cases: false, require_latency: true } });
    expect(updateMe).toHaveBeenCalledWith(expect.objectContaining({ onboarding: expect.objectContaining({ evidence_source: 'workload', time_to_first_evidence_ms: expect.any(Number) }) }));
    expect(engine.setTrial).toHaveBeenCalledWith('prod-w', expect.objectContaining({ status: 'active' }), { confirmBoundary: true });
    fireEvent.click(screen.getByRole('button', { name: /Open and test it/ }));
    await waitFor(() => expect(screen.getByText('app overview')).toBeTruthy());
  });

  it('says so explicitly when no supported opportunity is found', async () => {
    engine.findings.mockResolvedValueOnce([{ id: 'f1', category: 'context_review', origin: 'runtime_evidence', title: 'Long context', root_cause: '…', confidence: 0.9 }]);
    renderPage();
    await walkToFirstAnalysis();
    await screen.findByText('No supported opportunity found.');
    expect(screen.getByText(/not ones ZEVQORA can test yet/)).toBeTruthy();
  });

  it('surfaces an import that brought in nothing instead of continuing', async () => {
    engine.importTraces.mockResolvedValueOnce({ imported: 0, rejected: 3, errors: ['line 1: request_id is required'] });
    renderPage();
    await walkToFirstAnalysis();
    await screen.findByText('No traces imported: line 1: request_id is required');
  });
});
