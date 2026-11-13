// @vitest-environment jsdom
/**
 * Engineering Zev workspace (/app/zev): explorer → work area → inspector with
 * a resizable bottom chat on the real authenticated engine contract. The chat
 * is scoped to the selected workload, says when the provider is not
 * configured, can be cancelled and retried, keeps its thread per workspace,
 * and never shows tool results the backend did not return.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

const product = { id: 'p1', name: 'Support triage', root_path: 'workload://a', monitoring_enabled: false, created_at: '', last_scan_at: null };
const rejected = {
  id: 'e1aaaaaa-0000', product_id: 'p1', candidate_plan_id: null, candidate_execution_id: 'x', finding_id: null, status: 'REJECTED', evaluation_version: 'v1',
  sample_count: 50, protected_sample_count: 5, baseline_quality: 0.95, candidate_quality: 0.87, quality_delta: -0.08, baseline_cost_usd: 1, candidate_cost_usd: 0.58,
  raw_cost_delta_usd: -0.42, raw_cost_delta_percent: -42.01, baseline_latency_ms: null, candidate_latency_ms: null, evidence_completeness: true, verification_source: 'replay',
  execution_proven: true, evidence_version: 'ev1', gates: [{ name: 'quality_floor', required: true, outcome: 'fail', observed: 0.87, threshold: 0.95, reason: 'below floor' }],
  rejection_reason: 'Quality 0.87 below the frozen 0.95 floor.', grader_config_hash: 'g'.repeat(64), gate_config_hash: 'h'.repeat(64), created_at: '', completed_at: null, note: '',
};
const state = vi.hoisted(() => ({
  ws: 'w1',
  chat: vi.fn(),
  health: { openrouter_configured: true } as { openrouter_configured: boolean } | null,
}));
vi.mock('@/product/Frame', () => ({ ProductFrame: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ activeWorkspace: { id: state.ws, name: 'Alpha', role: 'member', plan: 'free', features: {} } }) }));
vi.mock('@/product/store', () => ({
  useProduct: () => ({
    engine: { chat: state.chat, kind: 'cloud' },
    products: [product],
    selected: product,
    selectProduct: vi.fn(),
    findings: [],
    evaluations: [rejected, { ...rejected, id: 'e2bbbbbb-0000', status: 'VERIFIED', gates: [], rejection_reason: null }],
    aiCalls: [],
    economics: { trace_count: 0 },
    health: state.health,
    model: '',
    refreshProductData: vi.fn(),
    setZevState: vi.fn(),
  }),
}));

const { default: ZevView } = await import('@/product/views/ZevView');
const { resetZevThreads } = await import('@/product/zevChat');
const show = () => render(<MemoryRouter><ZevView /></MemoryRouter>);

beforeEach(() => {
  resetZevThreads();
  state.ws = 'w1';
  state.health = { openrouter_configured: true };
  state.chat.mockReset();
});
afterEach(() => cleanup());

describe('Engineering Zev workspace', () => {
  it('lays out explorer, work area, inspector and a bottom Engineering Zev panel', () => {
    show();
    expect(screen.getByRole('navigation', { name: 'Workspace explorer' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'Work area' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeTruthy();
    const chat = screen.getByRole('region', { name: 'Engineering Zev' });
    expect(within(chat).getByText(/Scope: Support triage/)).toBeTruthy();
    expect(within(chat).getByText('Platform compute')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Ask Engineering Zev' })).toBeTruthy();
  });

  it('inspects a rejected run with its failed gate and offers "Why was this rejected?" scoped to it', async () => {
    state.chat.mockResolvedValue({ message: 'The quality_floor gate failed: 0.87 < 0.95.', model: 'm', provider: 'zevqora-platform', tool_events: [{ name: 'list_evaluations', status: 'done', summary: '2 evaluations' }], openrouter_configured: true });
    show();
    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'e1aaaaaa' })[0]);
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    expect(within(inspector).getByText('Quality 0.87 below the frozen 0.95 floor.')).toBeTruthy();
    expect(within(inspector).getByText(/quality_floor/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Why was this rejected?' }));
    await screen.findByText(/quality_floor gate failed/);
    const [productId, messages] = state.chat.mock.calls[0];
    expect(productId).toBe('p1');
    expect(messages.at(-1).content).toContain('evaluation e1aaaaaa-0000 (status REJECTED)');
    expect(screen.getByRole('list', { name: 'Tools Zev ran' }).textContent).toContain('list_evaluations');
    expect(screen.getByRole('button', { name: 'Compare these candidates' })).toBeTruthy();
  });

  it('says plainly when the provider is not configured, with no model attribution', async () => {
    state.health = { openrouter_configured: false };
    state.chat.mockResolvedValue({ message: 'Zev is ready, but platform compute is not configured on this deployment yet.', model: 'none', provider: 'none', tool_events: [], openrouter_configured: false });
    show();
    expect(screen.getByText('Not configured for this environment')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Engineering Zev' }), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Engineering Zev' }));
    expect(await screen.findByText(/Engineering Zev is not configured for this environment/)).toBeTruthy();
    expect(screen.queryByText('none')).toBeNull();
  });

  it('cancels a request (the signal aborts) and retries without duplicating the question', async () => {
    let signal: AbortSignal | undefined;
    state.chat.mockImplementationOnce((_p: string, _m: unknown, _model: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise((_r, reject) => s.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    });
    show();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Engineering Zev' }), { target: { value: 'Explain cost' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask Engineering Zev' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/ }));
    expect(signal?.aborted).toBe(true);
    expect((await screen.findByRole('alert')).textContent).toContain('Stopped');
    state.chat.mockResolvedValueOnce({ message: 'Cost comes from one call.', model: 'm', provider: 'p', tool_events: [], openrouter_configured: true });
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await screen.findByText('Cost comes from one call.');
    expect(screen.getAllByText('Explain cost')).toHaveLength(1);
  });

  it('keeps the thread per workspace across remounts, and never across workspaces', async () => {
    state.chat.mockResolvedValue({ message: 'Answer for alpha.', model: 'm', provider: 'p', tool_events: [], openrouter_configured: true });
    const first = show();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Engineering Zev' }), { target: { value: 'q1' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask Engineering Zev' }), { key: 'Enter' });
    await screen.findByText('Answer for alpha.');
    first.unmount();
    show();
    expect(screen.getByText('Answer for alpha.')).toBeTruthy();
    cleanup();
    state.ws = 'w2';
    show();
    expect(screen.queryByText('Answer for alpha.')).toBeNull();
  });

  it('collapses, expands and resizes the chat panel from the keyboard', () => {
    const { container } = show();
    const handle = screen.getByRole('separator', { name: 'Resize Engineering Zev panel' });
    const before = Number(handle.getAttribute('aria-valuenow'));
    act(() => { fireEvent.keyDown(handle, { key: 'ArrowUp' }); });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Engineering Zev' }));
    expect(container.querySelector('.zide')?.className).toContain('is-chat-closed');
    expect(screen.queryByRole('textbox', { name: 'Ask Engineering Zev' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Engineering Zev' }));
    expect(screen.getByRole('textbox', { name: 'Ask Engineering Zev' })).toBeTruthy();
  });
});
