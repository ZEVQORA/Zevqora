// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProductTour, PRODUCT_TOUR_STEPS, productTourStorageKey } from '../src/app/ProductTour';

afterEach(() => cleanup());

function mount(onClose = vi.fn()) {
  render(<MemoryRouter><ProductTour open onClose={onClose} /></MemoryRouter>);
  return onClose;
}

describe('ZEVQORA signed-in Quick Tour', () => {
  it('is an optional, non-modal five-step guide to real routes', () => {
    mount();
    expect(PRODUCT_TOUR_STEPS).toHaveLength(5);
    expect(screen.getByRole('dialog', { name: /start with the whole picture/i })).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getByRole('link', { name: /open command center/i }).getAttribute('href')).toBe('/app');
    expect(screen.getByText(/observed activity, experimental results/i)).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('false');
  });

  it('guides the user to setup, evidence and accurate verification status', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('link', { name: /start guided setup/i }).getAttribute('href')).toBe('/app/onboarding');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('link', { name: /see evidence sources/i }).getAttribute('href')).toBe('/app/connections');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/INCOMPLETE means there is not enough evidence/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /explore evidence/i }).getAttribute('href')).toBe('/app/evidence');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4');
  });

  it('is honest when the Engineering Zev provider is not configured', () => {
    mount();
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('link', { name: /open engineering zev/i }).getAttribute('href')).toBe('/app/zev');
    expect(screen.getByText(/provider may be unavailable until configured/i)).toBeTruthy();
  });

  it('can be skipped, exited with Escape, or finished', () => {
    const onClose = mount();
    fireEvent.click(screen.getByRole('button', { name: /skip tour/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('isolates completion state to the signed-in user and workspace', () => {
    expect(productTourStorageKey('user-A', 'workspace-1')).not.toBe(productTourStorageKey('user-B', 'workspace-1'));
    expect(productTourStorageKey('user-A', 'workspace-1')).not.toBe(productTourStorageKey('user-A', 'workspace-2'));
  });

  it('renders nothing while closed', () => {
    render(<MemoryRouter><ProductTour open={false} onClose={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
