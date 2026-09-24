// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

type SessionShape = {
  status: 'loading' | 'signed_out' | 'signed_in' | 'unconfigured';
  me: unknown;
  meError: string | null;
  meErrorCode: string | null;
  refreshMe: () => Promise<unknown>;
  signOut: () => Promise<void>;
};

let session: SessionShape;
vi.mock('@/lib/session', () => ({ useSession: () => session }));

const { RequireAuth } = await import('@/App');

function LoginProbe() {
  const location = useLocation();
  return <p>login page {location.search}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/" element={<p>home</p>} />
        <Route path="/app/*" element={<RequireAuth><p>protected app</p></RequireAuth>} />
      </Routes>
    </MemoryRouter>,
  );
}

const ME = { user: { id: 'u1', email: 'a@example.com' }, workspaces: [] };

beforeEach(() => {
  session = { status: 'signed_in', me: ME, meError: null, meErrorCode: null, refreshMe: vi.fn(async () => ME), signOut: vi.fn(async () => undefined) };
});
afterEach(() => cleanup());

describe('RequireAuth', () => {
  it('waits while the session is being restored instead of redirecting', () => {
    session.status = 'loading';
    renderAt('/app/experiments');
    expect(screen.getByText('Checking your session')).toBeTruthy();
    expect(screen.queryByText('protected app')).toBeNull();
    expect(screen.queryByText(/login page/)).toBeNull();
  });

  it('sends signed-out visitors to login and keeps where they were going', () => {
    session.status = 'signed_out';
    session.me = null;
    renderAt('/app/experiments?id=42');
    expect(screen.getByText(`login page ?next=${encodeURIComponent('/app/experiments?id=42')}`)).toBeTruthy();
    expect(screen.queryByText('protected app')).toBeNull();
  });

  it('renders the app for a restored session', () => {
    renderAt('/app');
    expect(screen.getByText('protected app')).toBeTruthy();
  });

  it('keeps the app on screen when a background refresh fails but the account is already loaded', () => {
    session.meError = 'Network error';
    renderAt('/app');
    expect(screen.getByText('protected app')).toBeTruthy();
  });

  it('shows the suspended state with a way out, never the app', () => {
    session.me = null;
    session.meError = 'This account is suspended. Contact support.';
    session.meErrorCode = 'ACCOUNT_SUSPENDED';
    renderAt('/app');
    expect(screen.getByText('This account is suspended.')).toBeTruthy();
    expect(screen.queryByText('protected app')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it('replaces the endless loader with a retryable error when the account cannot load', () => {
    session.me = null;
    session.meError = 'Request failed (502).';
    renderAt('/app');
    expect(screen.getByText('We could not load your account.')).toBeTruthy();
    expect(screen.getByText('Request failed (502).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(session.refreshMe).toHaveBeenCalledTimes(1);
  });
});
