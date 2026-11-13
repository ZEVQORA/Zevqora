// @vitest-environment jsdom
/**
 * Returning signed-in users land in the workspace: "/" redirects to /app once
 * the session is known, a browser with a stored session never flashes the
 * signed-out homepage while it is restored, and the website stays reachable
 * on purpose (/?site=1, or after an explicit sign-out).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

let status: 'loading' | 'signed_out' | 'signed_in' | 'unconfigured' = 'signed_out';
vi.mock('@/lib/session', () => ({ useSession: () => ({ status, me: null, meError: null, meErrorCode: null }) }));
vi.mock('@/marketing/HomePage', () => ({ default: () => <p>marketing home</p> }));
vi.mock('@/brand/BrandLoader', () => ({ FullPageLoader: ({ label }: { label: string }) => <p>{label}</p> }));

const { HomeRoute, hasStoredSession } = await import('@/App');

function renderAt(entry: string | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/app" element={<p>workspace dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('home route', () => {
  it('sends a signed-in user from / to the workspace', async () => {
    status = 'signed_in';
    renderAt('/');
    expect(await screen.findByText('workspace dashboard')).toBeTruthy();
  });

  it('shows the homepage to signed-out visitors', async () => {
    status = 'signed_out';
    renderAt('/');
    expect(await screen.findByText('marketing home')).toBeTruthy();
  });

  it('does not flash the signed-out homepage while a stored session is restored', async () => {
    status = 'loading';
    localStorage.setItem('zevqora.auth', JSON.stringify({ access_token: 'x', refresh_token: 'y' }));
    renderAt('/');
    expect(await screen.findByText('Opening your workspace')).toBeTruthy();
    expect(screen.queryByText('marketing home')).toBeNull();
  });

  it('renders the homepage immediately for a first-time visitor (no stored session)', async () => {
    status = 'loading';
    renderAt('/');
    expect(await screen.findByText('marketing home')).toBeTruthy();
  });

  it('keeps the website reachable on purpose', async () => {
    status = 'signed_in';
    renderAt('/?site=1');
    expect(await screen.findByText('marketing home')).toBeTruthy();
    cleanup();
    renderAt({ pathname: '/', state: { site: true } });
    expect(await screen.findByText('marketing home')).toBeTruthy();
  });

  it('recognises project-scoped storage keys and ignores unrelated entries', () => {
    localStorage.setItem('other', 'access_token');
    expect(hasStoredSession()).toBe(false);
    localStorage.setItem('zevqora.auth.dhqagbcaqspdrxcsxgfb', JSON.stringify({ access_token: 'x' }));
    expect(hasStoredSession()).toBe(true);
    expect(hasStoredSession(null)).toBe(false);
  });
});
