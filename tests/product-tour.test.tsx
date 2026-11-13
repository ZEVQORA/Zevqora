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
  it('is an optional, non-modal five-step guide to real routes, starting with Zev', () => {
    mount();
    expect(PRODUCT_TOUR_STEPS).toHaveLength(5);
    expect(screen.getByRole('dialog', { name: /ask zev anything/i })).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getByRole('link', { name: /^ask zev/i }).getAttribute('href')).toBe('/app');
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('false');
    expect(PRODUCT_TOUR_STEPS.some((s) => s.path === '/app/onboarding')).toBe(false);
  });

  it('teaches connect-when-ready, then verdicts, then the overview', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('link', { name: /connect my ai app/i }).getAttribute('href')).toBe('/app/connections');
    expect(screen.getByText(/only marked as sending data after the server has received it/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/INCOMPLETE means there is not enough evidence/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /explore evidence/i }).getAttribute('href')).toBe('/app/evidence');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('link', { name: /open overview/i }).getAttribute('href')).toBe('/app/command');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4');
  });

  it('is honest when the Engineering Zev provider is not configured', () => {
    mount();
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('link', { name: /open engineering zev/i }).getAttribute('href')).toBe('/app/zev');
    expect(screen.getByText(/provider may be unavailable until configured/i)).toBeTruthy();
  });

  it('can be skipped, paused to resume later, exited with Escape, or finished', () => {
    const onClose = mount();
    fireEvent.click(screen.getByRole('button', { name: /skip tour/i }));
    expect(onClose).toHaveBeenLastCalledWith('skipped');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /resume later/i }));
    expect(onClose).toHaveBeenLastCalledWith('paused', 1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenLastCalledWith('paused', 1);
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.queryByRole('button', { name: /resume later/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(onClose).toHaveBeenLastCalledWith('done');
  });

  it('resumes at the saved step', () => {
    render(<MemoryRouter><ProductTour open startAt={2} onClose={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
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
