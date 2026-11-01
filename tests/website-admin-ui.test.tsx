// @vitest-environment jsdom
/**
 * Part 3 website and admin UI. The website makes no customer or savings
 * claims, describes data boundaries precisely, and its evaluation form
 * validates and reports server failures. Admin pages drive the real API
 * contracts (mocked at the client boundary here): CMS draft → preview →
 * publish with confirmation, flag targeting limits, and a 404 for non-admins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/components/ui/Toast';

configure({ asyncUtilTimeout: 10_000 });
// jsdom has no IntersectionObserver (every supported browser does); Motion's in-view reveal needs one.
class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
vi.setConfig({ testTimeout: 30_000 });
afterEach(() => cleanup());

const session = { value: { status: 'signed_out', me: null as null | Record<string, unknown>, activeWorkspace: null } };
vi.mock('@/lib/session', () => ({ useSession: () => session.value }));
vi.mock('@/lib/supabase', () => ({ getSupabase: async () => null, supabaseSync: () => null, accessToken: async () => null, getEnabledOAuthProviders: async () => [] }));
const apiMock = vi.fn();
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: (...a: unknown[]) => apiMock(...a) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackProductView: vi.fn(), installCtaTracking: () => () => undefined, isWebsitePath: () => true, analyticsOptedOut: () => true }));

const wrap = (ui: React.ReactNode, path = '/') => render(<ToastProvider><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></ToastProvider>);

describe('website', () => {
  it('homepage leads with the design headline and the internal REJECTED example, labelled as internal', async () => {
    const { default: HomePage } = await import('@/marketing/HomePage');
    wrap(<HomePage />);
    // The design (207cab5) hero sets its two-line headline as one accessible name.
    expect(screen.getByRole('heading', { level: 1, name: 'Make AI lighter.' })).toBeTruthy();
    expect(document.body.textContent).toMatch(/42\.01\s*%/);
    expect(screen.getByText(/Internal 50-case dogfooding benchmark\. Not customer evidence\./)).toBeTruthy();
    const text = document.body.textContent || '';
    expect(text).not.toMatch(/our customers|trusted by|paying customers|saved \$|realized savings of/i);
    expect(screen.getAllByText(/Illustrative values|SAMPLE DATA/i).length).toBeGreaterThan(0);
    expect(document.title).toMatch(/Make AI lighter/);
    expect(document.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe('https://zevqora.vercel.app');
  });

  it('the security page says imported trace files keep prompt content, instead of claiming nothing is stored', async () => {
    const { default: SecurityPage } = await import('@/marketing/SecurityPage');
    wrap(<SecurityPage />);
    expect(screen.getAllByText(/an imported trace file keeps what you export: redact before import/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/prompts and outputs included/).length).toBeGreaterThan(0);
  });

  it('the evaluation form validates locally, then submits once and confirms', async () => {
    const { default: EvaluationPage } = await import('@/marketing/EvaluationPage');
    apiMock.mockReset().mockResolvedValue({ ok: true, id: 'x' });
    wrap(<EvaluationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Send evaluation request' }));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(expect.arrayContaining(['Enter your name.', 'Enter a valid work email.', 'Please confirm we may contact you about this evaluation.']));
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Example' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Example AI' } });
    fireEvent.change(screen.getByLabelText('Which AI workflow should we look at?'), { target: { value: 'Support agent with retrieval and retries.' } });
    fireEvent.click(screen.getByLabelText(/may contact me by email/));
    fireEvent.click(screen.getByRole('button', { name: 'Send evaluation request' }));
    expect(await screen.findByText('Thank you — we have your request.')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [path, opts] = apiMock.mock.calls[0] as [string, { method: string; auth: boolean; body: Record<string, unknown> }];
    expect(path).toBe('/api/evaluation-requests');
    expect(opts).toMatchObject({ method: 'POST', auth: false, body: { name: 'Ada Example', email: 'ada@example.com', consent: true, website: '' } });
  });

  it('a server failure is announced and the form stays filled for retry', async () => {
    const { default: EvaluationPage } = await import('@/marketing/EvaluationPage');
    apiMock.mockReset().mockRejectedValue(new Error('Too many requests. Slow down and retry shortly.'));
    wrap(<EvaluationPage />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Example' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Example AI' } });
    fireEvent.change(screen.getByLabelText('Which AI workflow should we look at?'), { target: { value: 'Support agent with retrieval and retries.' } });
    fireEvent.click(screen.getByLabelText(/may contact me by email/));
    fireEvent.click(screen.getByRole('button', { name: 'Send evaluation request' }));
    expect((await screen.findByText(/Too many requests/)).getAttribute('role')).toBe('alert');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ada Example');
  });

  it('inside an admin preview the form is disabled and page metadata is untouched', async () => {
    const { default: EvaluationPage } = await import('@/marketing/EvaluationPage');
    const { SiteContentOverride } = await import('@/lib/site');
    document.title = 'Admin — ZEVQORA';
    apiMock.mockReset();
    wrap(<SiteContentOverride value={{ evaluation_page: { title: 'Draft title', intro: null, what_you_get: [], response_note: null } }}><EvaluationPage /></SiteContentOverride>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Draft title');
    expect((screen.getByRole('button', { name: 'Send evaluation request' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.title).toBe('Admin — ZEVQORA');
  });
});

// ----------------------------------------------------------------------- admin
const v3 = {
  cms: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn(),
  discardDraft: vi.fn(),
  rollback: vi.fn(),
  revision: vi.fn(),
  flagReach: vi.fn(),
  setTargeting: vi.fn(),
};
vi.mock('@/admin/data-v3', () => ({ adminV3: new Proxy({}, { get: (_t, k: string) => (v3 as Record<string, unknown>)[k] }) }));
const legacy = { flags: vi.fn(), saveFlag: vi.fn() };
vi.mock('@/admin/data', () => ({ admin: new Proxy({}, { get: (_t, k: string) => (legacy as Record<string, unknown>)[k] }) }));

const HERO = { announcement: null, announcement_href: null, headline: 'Make AI cheaper without guessing.', subheadline: null, supporting: 's', primary_cta: { label: 'Go', href: '/evaluation' }, secondary_cta: { label: 'More', href: '/product' }, trust_line: 't' };
const SCHEMAS = [{ key: 'hero', label: 'Homepage hero', fields: { headline: { type: 'text', max: 80, required: true, label: 'Headline' }, trust_line: { type: 'text', max: 120, label: 'Trust line' } } }];
const cmsState = (draft: boolean) => ({ schemas: SCHEMAS, keys: [{ key: 'hero', live: { key: 'hero', value: HERO, updated_at: '2026-10-01T00:00:00Z' }, live_revision: { id: 'r1', key: 'hero', version: 1, status: 'published', note: null, source_revision_id: null, created_by: null, created_at: '', published_by: null, published_at: '2026-10-01T00:00:00Z' }, draft: draft ? { id: 'r2', key: 'hero', version: 2, status: 'draft', value: { ...HERO, headline: 'New headline' }, note: null, source_revision_id: null, created_by: null, created_at: '2026-10-02T00:00:00Z', published_by: null, published_at: null } : null, history: [] }] });

describe('admin', () => {
  beforeEach(() => {
    Object.values(v3).forEach((f) => f.mockReset());
    Object.values(legacy).forEach((f) => f.mockReset());
  });

  it('a signed-in non-admin gets the 404 page for /admin, never the console', async () => {
    session.value = { status: 'signed_in', me: { isAdmin: false, user: { id: 'u' }, workspaces: [] }, activeWorkspace: null };
    const { default: AdminRoutes } = await import('@/admin/AdminRoutes');
    wrap(<Routes><Route path="/admin/*" element={<AdminRoutes />} /></Routes>, '/admin/content');
    expect(await screen.findByText('404')).toBeTruthy();
    expect(document.title).toMatch(/Page not found/);
    expect(screen.queryByText('Website content')).toBeNull();
    expect(v3.cms).not.toHaveBeenCalled();
  });

  it('CMS: edits become a saved draft; publishing needs a confirmation and calls the publish contract', async () => {
    session.value = { status: 'signed_in', me: { isAdmin: true }, activeWorkspace: null };
    v3.cms.mockResolvedValueOnce(cmsState(false)).mockResolvedValue(cmsState(true));
    v3.saveDraft.mockResolvedValue({ draft: { id: 'r2', version: 2 } });
    v3.publish.mockResolvedValue({ published: { key: 'hero', version: 2 } });
    const { default: AdminContentPage } = await import('@/admin/pages/AdminContentPage');
    wrap(<AdminContentPage />);
    const headline = (await screen.findByLabelText('Headline')) as HTMLInputElement;
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(headline, { target: { value: 'New headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(v3.saveDraft).toHaveBeenCalledWith('hero', expect.objectContaining({ headline: 'New headline' }), undefined));
    const publish = await screen.findByRole('button', { name: 'Publish' });
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(publish);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Publish draft v2 to the live website\?/)).toBeTruthy();
    expect(v3.publish).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(v3.publish).toHaveBeenCalledWith('hero', 'r2'));
  });

  it('CMS: a server validation error is shown, not swallowed', async () => {
    v3.cms.mockResolvedValue(cmsState(false));
    v3.saveDraft.mockRejectedValue(new Error('Primary CTA link must be a site path, an https URL or a mailto link.'));
    const { default: AdminContentPage } = await import('@/admin/pages/AdminContentPage');
    wrap(<AdminContentPage />);
    fireEvent.change(await screen.findByLabelText('Headline'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect((await screen.findByText(/must be a site path/)).getAttribute('role')).toBe('alert');
  });

  it('flags: platform-wide flags offer only off/on; a change is confirmed before it is sent', async () => {
    legacy.flags.mockResolvedValue({ flags: [
      { key: 'visitor_intelligence', description: 'site analytics', enabled: false, targeting: null, rollout_percent: null, plan_overrides: {}, workspace_overrides: {}, updated_at: '2026-10-01T00:00:00Z' },
      { key: 'zevir_graph_ui', description: 'graph', enabled: false, targeting: 'internal', rollout_percent: null, plan_overrides: {}, workspace_overrides: {}, updated_at: '2026-10-01T00:00:00Z' },
    ] });
    v3.flagReach.mockResolvedValue({ reach: { zevir_graph_ui: { workspaces_on: 1, workspaces_total: 3, internal_workspaces: 1 } } });
    v3.setTargeting.mockResolvedValue({});
    const { default: AdminFlagsPage } = await import('@/admin/pages/AdminFlagsPage');
    wrap(<AdminFlagsPage />);
    const global = await screen.findByRole('radiogroup', { name: 'Targeting for visitor_intelligence' });
    expect(within(global).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Global switch', 'Off', 'On']);
    const scoped = screen.getByRole('radiogroup', { name: 'Targeting for zevir_graph_ui' });
    expect(within(scoped).getAllByRole('radio')).toHaveLength(6);
    expect(await screen.findByText(/on for 1 of 3 workspaces/)).toBeTruthy();
    fireEvent.click(within(scoped).getByRole('radio', { name: 'On' }));
    const dialog = await screen.findByRole('dialog');
    expect(v3.setTargeting).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply change' }));
    await waitFor(() => expect(v3.setTargeting).toHaveBeenCalledWith('zevir_graph_ui', 'on'));
  });
});
