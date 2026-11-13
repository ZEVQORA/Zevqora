// @vitest-environment jsdom
/**
 * Founder UX correction 2026-11-13: chat-first /app, explanation preference
 * (presentation only), honest provider-unavailable state, labelled sample,
 * truthful connection statuses, default onboarding that does not lead to a
 * folder picker, and a keyboard-operable workspace switcher.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

type Ws = { id: string; name: string; role: string; plan: string; features: Record<string, boolean> };
const WS: Ws = { id: 'ws-1', name: 'Acme', role: 'owner', plan: 'free', features: {} };
const state = {
  onboarding: {} as Record<string, unknown>,
  workspaces: [WS] as Ws[],
  provider: 'none' as 'none' | 'openrouter' | 'anthropic',
  products: [] as Array<{ id: string; name: string }>,
};
const refreshMe = vi.fn(async () => null);
const setActiveWorkspaceId = vi.fn();
vi.mock('@/lib/session', () => ({
  useSession: () => ({
    me: { user: { id: 'u-1', email: 'x@example.invalid' }, profile: { display_name: 'Ada', username: null, onboarding: state.onboarding }, workspaces: state.workspaces, isAdmin: false },
    activeWorkspace: state.workspaces[0] || null,
    refreshMe,
    setActiveWorkspaceId,
  }),
}));

const updateMe = vi.fn(async (body: { onboarding?: Record<string, unknown> }) => {
  state.onboarding = { ...state.onboarding, ...(body.onboarding || {}) };
  return {};
});
const projects = vi.fn(async () => ({ projects: [] as unknown[] }));
const createWorkspace = vi.fn(async (name: string) => ({ workspace: { id: 'ws-new', name } }));
vi.mock('@/app/data', () => ({
  app: {
    updateMe: (b: { onboarding?: Record<string, unknown> }) => updateMe(b),
    projects: () => projects(),
    runtime: vi.fn(),
    createProject: vi.fn(),
    createConnection: vi.fn(),
    revokeConnection: vi.fn(),
    createWorkspace: (n: string) => createWorkspace(n),
  },
}));

const chat = vi.fn(async () => ({ message: 'ZEVQORA tests cheaper plans on your own examples.', tool_events: [], provider: 'openrouter', model: 'm', provider_configured: true }));
vi.mock('@/product/store', () => ({
  useProduct: () => ({
    engine: { chat },
    health: { engineering_zev_provider: state.provider, openrouter_configured: state.provider === 'openrouter' },
    products: state.products,
    selected: state.products[0] || null,
    model: null,
    refreshProductData: vi.fn(),
    setZevState: vi.fn(),
  }),
  rememberSelectedProduct: vi.fn(),
}));
vi.mock('@/product/experience', async (orig) => ({ ...(await orig<typeof import('@/product/experience')>()), experienceApi: { commandCenter: vi.fn(async () => ({ decision_queue: [{}, {}] })) } }));

const { default: ZevHome } = await import('@/product/command/ZevHome');
const { resetZevThreads } = await import('@/product/zevChat');
const { default: ConnectChooser, liteStatus } = await import('@/product/views/ConnectChooser');
const { WorkspaceSwitcher } = await import('@/app/AppShell');

beforeEach(() => {
  state.onboarding = {};
  state.workspaces = [WS];
  state.provider = 'none';
  state.products = [];
  vi.clearAllMocks();
  resetZevThreads();
});
afterEach(() => cleanup());

const home = (path = '/app') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={<ZevHome />} />
        <Route path="/app/connections" element={<p>connections page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('chat-first home', () => {
  it('greets a new user with Zev, four starting actions and no folder or upload requirement', () => {
    home();
    expect(screen.getByRole('heading', { name: /Hi, I.m Zev. What would you like to improve\?/ })).toBeTruthy();
    for (const label of ['Explain how ZEVQORA works', 'Connect my AI app', 'Try a safe demo', 'Why is my AI expensive?']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Advanced setup' }).getAttribute('href')).toBe('/app/onboarding?advanced=1');
    expect(screen.queryByText(/choose folder/i)).toBeNull();
  });

  it('asks how Zev should explain things and stores it as a profile preference only', async () => {
    home();
    expect(screen.getByText('How would you like Zev to explain things?')).toBeTruthy();
    expect(screen.getByText(/does not change what you can see or do/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Non-technical/ }));
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ onboarding: { explain_mode: 'nontechnical' } }));
    expect(refreshMe).toHaveBeenCalled();
  });

  it('is honest when no AI provider is configured: typing is off, written guides still work', () => {
    state.onboarding = { explain_mode: 'later' };
    home();
    expect(screen.getByText('AI assistance is currently unavailable.')).toBeTruthy();
    expect((screen.getByLabelText('Ask Zev') as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Explain how ZEVQORA works' }));
    expect(screen.getByText(/Guide · written by the ZEVQORA team/)).toBeTruthy();
    expect(screen.getByText(/A change is only marked VERIFIED/)).toBeTruthy();
    expect(chat).not.toHaveBeenCalled();
  });

  it('labels the demo as a sample and never as the user’s data', () => {
    state.onboarding = { explain_mode: 'nontechnical' };
    home();
    fireEvent.click(screen.getByRole('button', { name: 'Try a safe demo' }));
    expect(screen.getByText(/SAMPLE · not your data/)).toBeTruthy();
    expect(screen.getByText(/Not customer evidence/)).toBeTruthy();
    expect(screen.getAllByText('REJECTED').length).toBeGreaterThan(0);
  });

  it('opens the sample from a ?demo=1 link', () => {
    home('/app?demo=1');
    expect(screen.getByText(/SAMPLE · not your data/)).toBeTruthy();
  });

  it('sends questions to the authenticated Zev with the chosen explanation style', async () => {
    state.provider = 'openrouter';
    state.onboarding = { explain_mode: 'technical' };
    home();
    fireEvent.change(screen.getByLabelText('Ask Zev'), { target: { value: 'Where does my cost go?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Zev' }));
    await screen.findByText('ZEVQORA tests cheaper plans on your own examples.');
    expect(chat).toHaveBeenCalledWith(null, [{ role: 'user', content: 'Where does my cost go?' }], undefined, expect.any(AbortSignal), 'technical');
  });

  it('welcomes a returning user back with real pending work and Continue with Zev', async () => {
    state.provider = 'openrouter';
    state.onboarding = { explain_mode: 'nontechnical' };
    state.products = [{ id: 'p1', name: 'support-bot' }];
    home();
    expect(screen.getByRole('heading', { name: 'Welcome back, Ada.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Continue with Zev/ }).getAttribute('href')).toBe('/app/zev');
    await screen.findByText(/2 decisions need you/);
  });
});

describe('connect your AI app', () => {
  const conn = (over: Record<string, unknown> = {}) => ({ id: 'c', workspace_id: 'ws-1', project_id: 'p', kind: 'server_telemetry', name: 'LiteLLM gateway', status: 'active', token_prefix: 'zq_', token_last4: 'abcd', scopes: [], permissions: {}, metadata: {}, created_by: 'u', created_at: '2026-11-13T00:00:00Z', last_used_at: null, last_seen_at: null, revoked_at: null, ...over }) as never;

  it('derives status only from what the server reports', () => {
    expect(liteStatus(null)).toBe('not_connected');
    expect(liteStatus(conn())).toBe('authorized');
    expect(liteStatus(conn({ last_seen_at: '2026-11-13T01:00:00Z' }))).toBe('data_flowing');
    // Activity recorded before this token existed (e.g. an older revoked token) is not this token's data.
    expect(liteStatus(conn({ last_seen_at: '2026-11-12T23:00:00Z' }))).toBe('authorized');
  });

  it('never shows Vercel or GitHub as connected, and offers the working alternatives', async () => {
    render(<MemoryRouter><ConnectChooser /></MemoryRouter>);
    await waitFor(() => expect(projects).toHaveBeenCalled());
    await screen.findByText('Not connected');
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.getByText(/A Vercel connection alone is not AI evidence/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a LiteLLM token' })).toBeTruthy();
    expect(screen.queryByText(/^Connected$/)).toBeNull();
    expect(screen.queryByText(/VERIFIED/)).toBeNull();
    expect(screen.getByText('Preview · not enabled here')).toBeTruthy();
  });
});

describe('default onboarding', () => {
  it('creates the workspace and goes straight to Zev, with no folder step', async () => {
    state.workspaces = [];
    vi.doMock('@/product/engine', () => ({ cloudEngine: vi.fn(), localEngine: vi.fn(), engineErrorMessage: String }));
    const { default: OnboardingPage } = await import('@/app/pages/OnboardingPage');
    render(
      <MemoryRouter initialEntries={['/app/onboarding']}>
        <Routes>
          <Route path="/app/onboarding" element={<OnboardingPage />} />
          <Route path="/app" element={<p>zev home</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Onboarding progress')).toBeNull();
    fireEvent.change(await screen.findByLabelText('Workspace name'), { target: { value: 'Acme AI' } });
    fireEvent.click(screen.getByRole('button', { name: /Create workspace/ }));
    await screen.findByText('zev home');
    expect(createWorkspace).toHaveBeenCalledWith('Acme AI');
  });
});

describe('workspace switcher', () => {
  it('opens a readable listbox, moves with arrow keys, closes on Escape and returns focus', async () => {
    state.workspaces = [WS, { ...WS, id: 'ws-2', name: 'Beta', role: 'viewer' }];
    render(<MemoryRouter><WorkspaceSwitcher collapsed={false} /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: /Switch workspace/ });
    fireEvent.click(trigger);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(options[0]));
    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    expect(screen.getByRole('button', { name: /New workspace/ })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(options[1], { key: 'Escape' });
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('switches workspace when an option is chosen', () => {
    state.workspaces = [WS, { ...WS, id: 'ws-2', name: 'Beta', role: 'viewer' }];
    render(<MemoryRouter><WorkspaceSwitcher collapsed={false} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Switch workspace/ }));
    fireEvent.click(screen.getByRole('option', { name: /Beta/ }));
    expect(setActiveWorkspaceId).toHaveBeenCalledWith('ws-2');
  });
});
