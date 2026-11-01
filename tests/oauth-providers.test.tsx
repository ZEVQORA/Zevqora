/**
 * Social sign-in buttons appear only for providers Supabase Auth has enabled.
 * Production has email only, so a Google or GitHub button there would end on a
 * Supabase 400 ("provider is not enabled") — a feature shown as working that is not.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/config', () => ({
  getConfigSync: () => ({ supabaseUrl: '', supabaseAnonKey: '' }),
  loadConfig: async () => ({ supabaseUrl: 'https://example-ref.supabase.co', supabaseAnonKey: 'sb_publishable_test_key_long_enough' }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fresh(settings: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => settings }));
  vi.stubGlobal('fetch', fetchMock);
  const lib = await import('@/lib/supabase');
  lib.resetOAuthProvidersForTests();
  return { lib, fetchMock };
}

describe('enabled OAuth providers', () => {
  it('reads the public Auth settings with the publishable key and keeps only enabled providers', async () => {
    const { lib, fetchMock } = await fresh({ external: { email: true, google: true, github: false } });
    expect(await lib.getEnabledOAuthProviders()).toEqual(['google']);
    expect(fetchMock).toHaveBeenCalledWith('https://example-ref.supabase.co/auth/v1/settings', { headers: { apikey: 'sb_publishable_test_key_long_enough' } });
  });

  it('shows nothing when the settings cannot be read', async () => {
    const { lib } = await fresh({}, false);
    expect(await lib.getEnabledOAuthProviders()).toEqual([]);
  });

  it('renders no buttons and no divider when only email is enabled', async () => {
    const { lib } = await fresh({ external: { email: true, google: false, github: false } });
    const { OAuthButtons, OrDivider } = await import('@/auth/AuthShell');
    const { container } = render(<><OAuthButtons onClick={() => {}} /><OrDivider /></>);
    await lib.getEnabledOAuthProviders();
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(screen.queryByText('Google')).toBeNull();
    expect(screen.queryByText('or with email')).toBeNull();
  });

  it('renders only the enabled provider and the divider', async () => {
    const { lib } = await fresh({ external: { github: true } });
    const { OAuthButtons, OrDivider } = await import('@/auth/AuthShell');
    render(<><OAuthButtons onClick={() => {}} /><OrDivider /></>);
    await lib.getEnabledOAuthProviders();
    expect(await screen.findByText('GitHub')).toBeTruthy();
    expect(screen.queryByText('Google')).toBeNull();
    expect(screen.getByText('or with email')).toBeTruthy();
  });
});
