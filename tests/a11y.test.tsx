// @vitest-environment jsdom
/**
 * Automated WCAG checks (axe-core) on the main Part 3 surfaces. jsdom cannot
 * compute colour contrast or layout, so `color-contrast` is disabled here and
 * checked manually; every other WCAG 2.x A/AA rule axe knows must pass.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import axe from 'axe-core';
import { ToastProvider } from '@/components/ui/Toast';

configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 60_000 });
class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
afterEach(() => cleanup());

vi.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signed_out', me: null, activeWorkspace: { id: 'w', name: 'W', role: 'owner', plan: 'free', features: {} } }) }));
vi.mock('@/lib/supabase', () => ({ getSupabase: async () => null, supabaseSync: () => null, accessToken: async () => null, getEnabledOAuthProviders: async () => [] }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackProductView: vi.fn(), installCtaTracking: () => () => undefined, isWebsitePath: () => true, analyticsOptedOut: () => true }));

vi.mock('@/product/store', () => ({ useProduct: () => ({ selectProduct: vi.fn() }) }));
const ccApi = { commandCenter: vi.fn() };
vi.mock('@/product/experience', async (orig) => ({ ...(await orig<typeof import('@/product/experience')>()), experienceApi: new Proxy({}, { get: (_t, k: string) => (ccApi as Record<string, unknown>)[k] }) }));
const v3 = { cms: vi.fn() };
vi.mock('@/admin/data-v3', () => ({ adminV3: new Proxy({}, { get: (_t, k: string) => (v3 as Record<string, unknown>)[k] }) }));

async function violations(container: HTMLElement) {
  const res = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } });
  return res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const page = (ui: React.ReactNode) => render(<ToastProvider><MemoryRouter><main>{ui}</main></MemoryRouter></ToastProvider>);

describe('axe (WCAG 2.2 A/AA, contrast excluded)', () => {
  it('home page', async () => {
    const { default: HomePage } = await import('@/marketing/HomePage');
    const { container } = page(<HomePage />);
    expect(await violations(container)).toEqual([]);
  });

  it('evaluation page with its form, including the error state', async () => {
    const { default: EvaluationPage } = await import('@/marketing/EvaluationPage');
    const { container } = page(<EvaluationPage />);
    screen.getByRole('button', { name: 'Send evaluation request' }).click();
    await screen.findAllByRole('alert');
    expect(await violations(container)).toEqual([]);
  });

  it('product and how-it-works pages', async () => {
    const { default: ProductPage } = await import('@/marketing/ProductPage');
    const { default: TechnologyPage } = await import('@/marketing/HowItWorksPage');
    const a = page(<ProductPage />);
    expect(await violations(a.container)).toEqual([]);
    cleanup();
    const b = page(<TechnologyPage />);
    expect(await violations(b.container)).toEqual([]);
  });

  it('security and company pages', async () => {
    const { default: SecurityPage } = await import('@/marketing/SecurityPage');
    const { default: CompanyPage } = await import('@/marketing/CompanyPage');
    const a = page(<SecurityPage />);
    expect(await violations(a.container)).toEqual([]);
    cleanup();
    const b = page(<CompanyPage />);
    expect(await violations(b.container)).toEqual([]);
  });

  it('marketing header, navigation and footer', async () => {
    const { SiteHeader, SiteFooter } = await import('@/marketing/MarketingLayout');
    const { container } = render(<MemoryRouter><SiteHeader /><main><h1>Page</h1></main><SiteFooter /></MemoryRouter>);
    expect(await violations(container)).toEqual([]);
  });

  it('Command Center (empty and populated states) and the CMS editor', async () => {
    const { PresentationModeProvider } = await import('@/lib/mode');
    const { default: CommandCenterView } = await import('@/product/command/CommandCenterView');
    ccApi.commandCenter.mockResolvedValue({ workspace_id: 'w', role: 'owner', generated_at: '2026-10-12T00:00:00Z', range: { from: '', to: '', days: 30 }, synthetic: false, observed: { claim: 'OBSERVED', source: 'engine_traces', window: { from: '', to: '' }, truncated: false, trace_limit: 5000, requests: 0, spend_usd: null, cost_known: 0, cost_coverage: null, latency: { p50_ms: null, p95_ms: null, p99_ms: null, samples: 0, p99_note: null }, ttft: { p50_ms: null, p95_ms: null, samples: 0 }, retries: 0, daily: [], by_model: [], by_workflow: [] }, products: [], pipeline: {}, verdicts: { claim: 'EVALUATED', VERIFIED: 0, REJECTED: 0, INCOMPLETE: 0, total: 0 }, value: { evaluated: [], projected: { claim: 'PROJECTED', monthly_cost_change_usd: null, plans: 0 }, realized: { claim: 'REALIZED', status: 'NOT_YET_MEASURED', reason: 'x' } }, decision_queue: [], risks: [] });
    const a = page(<PresentationModeProvider><CommandCenterView /></PresentationModeProvider>);
    await screen.findByText('Connect your first AI workload');
    expect(await violations(a.container)).toEqual([]);
    cleanup();
    v3.cms.mockResolvedValue({ schemas: [{ key: 'hero', label: 'Homepage hero', fields: { headline: { type: 'text', max: 80, required: true, label: 'Headline' }, primary_cta: { type: 'cta', label: 'Primary CTA' } } }], keys: [{ key: 'hero', live: { key: 'hero', value: { headline: 'H', primary_cta: { label: 'Go', href: '/x' } }, updated_at: '' }, live_revision: null, draft: null, history: [] }] });
    const { default: AdminContentPage } = await import('@/admin/pages/AdminContentPage');
    const b = page(<AdminContentPage />);
    await screen.findByLabelText('Headline');
    expect(await violations(b.container)).toEqual([]);
  });

  it('confirmation dialog: focus moves in, Tab is trapped, Escape closes, focus returns to the trigger', async () => {
    const { useState } = await import('react');
    const { fireEvent } = await import('@testing-library/react');
    const { ConfirmDialog } = await import('@/components/ui/Dialog');
    const onConfirm = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Publish</button>
          <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={onConfirm} title="Publish draft?" confirmLabel="Confirm publish" />
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Publish' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await new Promise((r) => setTimeout(r, 60));
    expect(dialog.contains(document.activeElement)).toBe(true);
    const buttons = [...dialog.querySelectorAll('button')];
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 400));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(await violations(document.body)).toEqual([]);
  });
});
