// @vitest-environment jsdom
/**
 * The public Ask Zev composer on the homepage: one mounted input that moves
 * between the hero slot and the bottom-right dock with its draft, thread and
 * focus; Enter / Shift+Enter; loading, cancel, retry and offline states;
 * answers labelled by source; at most two dismissible section suggestions per
 * session and never an unprompted message; and the dimensional Z mark's
 * reduced-motion and offscreen behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import axe from 'axe-core';
import { ApiClientError } from '@/lib/api';

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

const apiMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: (...args: unknown[]) => apiMock.fn(...args) }));

/** Controllable IntersectionObserver: tests decide what is on screen. */
type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
const observers: { cb: IOCallback; targets: Element[] }[] = [];
class FakeIO {
  cb: IOCallback;
  targets: Element[] = [];
  constructor(cb: IOCallback) {
    this.cb = cb;
    observers.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.targets = [];
  }
  takeRecords() {
    return [];
  }
}
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;

function fire(el: Element, entry: Partial<IntersectionObserverEntry>) {
  act(() => {
    for (const o of observers) if (o.targets.includes(el)) o.cb([{ target: el, ...entry }]);
  });
}
const rect = (top: number) => ({ top, bottom: top + 10 }) as DOMRectReadOnly;
const scrollPastHero = (slot: Element) => fire(slot, { isIntersecting: false, boundingClientRect: rect(-400), intersectionRatio: 0 });
const scrollBackToHero = (slot: Element) => fire(slot, { isIntersecting: true, boundingClientRect: rect(300), intersectionRatio: 1 });

async function violations(container: HTMLElement) {
  const res = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } });
  return res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const { AskZev, QUICK_CHIPS } = await import('@/marketing/askzev/AskZev');
const { MAX_SUGGESTIONS_PER_SESSION } = await import('@/marketing/askzev/useSectionSuggestion');

function Page({ sections = false }: { sections?: boolean }) {
  return (
    <main>
      <h1>Make AI lighter.</h1>
      <div data-testid="slot">
        <AskZev />
      </div>
      <a href="/signup">Start optimizing</a>
      {sections && (
        <>
          <section id="product">Product</section>
          <section id="proof">Proof</section>
          <section className="engine-boundaries">Boundaries</section>
          <section className="engine-home-pricing">Pricing</section>
        </>
      )}
    </main>
  );
}

const mount = (sections = false) => render(<MemoryRouter><Page sections={sections} /></MemoryRouter>);
const textbox = () => screen.getByRole('textbox', { name: 'Ask Zev a question about ZEVQORA' }) as HTMLTextAreaElement;
const answer = (over: Record<string, unknown> = {}) => ({ answer: 'ZEVQORA replays lighter plans and keeps what passes your gates.', mode: 'faq', topic: 'what', links: [{ label: 'Explore the product', href: '/product' }], contact: 'team@example.invalid', ...over });

beforeEach(() => {
  observers.length = 0;
  apiMock.fn.mockReset();
  window.sessionStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Ask Zev composer', () => {
  it('starts in the hero with the four quick chips, one input, no thread and no request', async () => {
    const { container } = mount();
    expect(container.querySelector('.zev-ask')?.className).toContain('is-hero');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    const chips = screen.getByRole('group', { name: 'Suggested questions' });
    expect(Array.from(chips.querySelectorAll('button')).map((b) => b.textContent)).toEqual([...QUICK_CHIPS]);
    expect(QUICK_CHIPS).toEqual(['What does ZEVQORA do?', 'How do I connect my server?', 'Why verify before optimizing?', 'Can I talk to your team?']);
    // Never an unprompted message: no thread until the visitor asks.
    expect(screen.queryByRole('log')).toBeNull();
    expect(apiMock.fn).not.toHaveBeenCalled();
    expect(screen.getByText(/not a live person/)).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it('follows the headline and precedes the CTAs in document (tab) order', () => {
    mount();
    const h1 = screen.getByRole('heading', { level: 1 });
    const cta = screen.getByRole('link', { name: 'Start optimizing' });
    expect(h1.compareDocumentPosition(textbox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(textbox().compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Enter sends, Shift+Enter does not; the answer is labelled Guide / FAQ with internal links', async () => {
    apiMock.fn.mockResolvedValue(answer());
    mount();
    fireEvent.change(textbox(), { target: { value: 'What is it?' } });
    fireEvent.keyDown(textbox(), { key: 'Enter', shiftKey: true });
    expect(apiMock.fn).not.toHaveBeenCalled();
    fireEvent.keyDown(textbox(), { key: 'Enter' });
    expect(apiMock.fn).toHaveBeenCalledTimes(1);
    const [path, opts] = apiMock.fn.mock.calls[0];
    expect(path).toBe('/api/support/message');
    expect(opts).toMatchObject({ method: 'POST', auth: false, body: { message: 'What is it?', history: [], page: 'hero' } });
    expect(textbox().value).toBe('');
    const log = await screen.findByRole('log', { name: 'Conversation with Zev' });
    await screen.findByText(/replays lighter plans/);
    expect(log.textContent).toContain('Guide / FAQ');
    expect(screen.getByRole('link', { name: 'Explore the product' }).getAttribute('href')).toBe('/product');
  });

  it('labels generated answers as AI and sends the earlier turns as history', async () => {
    apiMock.fn.mockResolvedValueOnce(answer()).mockResolvedValueOnce(answer({ mode: 'ai', answer: 'A generated public answer.' }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'What does ZEVQORA do?' }));
    await screen.findByText(/replays lighter plans/);
    fireEvent.change(textbox(), { target: { value: 'And then?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('A generated public answer.');
    expect(screen.getByRole('log').textContent).toContain('AI answer · public info only');
    expect(apiMock.fn.mock.calls[1][1].body.history).toEqual([
      { role: 'user', content: 'What does ZEVQORA do?' },
      { role: 'assistant', content: answer().answer },
    ]);
  });

  it('shows a loading state that can be cancelled, then retried', async () => {
    let signal: AbortSignal | undefined;
    apiMock.fn.mockImplementationOnce((_p: string, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise((_r, reject) => o.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Why verify before optimizing?' }));
    expect(screen.getByRole('status').textContent).toContain('Zev is answering');
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(signal?.aborted).toBe(true);
    expect((await screen.findByRole('alert')).textContent).toContain('Stopped');
    apiMock.fn.mockResolvedValueOnce(answer({ topic: 'verify', answer: 'Verified means every gate passed.' }));
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await screen.findByText('Verified means every gate passed.');
    expect(apiMock.fn.mock.calls[1][1].body.message).toBe('Why verify before optimizing?');
    // The question is not duplicated by the retry.
    expect(screen.getAllByText('Why verify before optimizing?').filter((el) => el.closest('.zev-ask-msg'))).toHaveLength(1);
  });

  it('keeps the question after a server error or a rate limit and offers Retry', async () => {
    apiMock.fn.mockRejectedValueOnce(new ApiClientError(429, 'You are sending messages quickly. Wait a moment and try again.', 'RATE_LIMITED'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Can I talk to your team?' }));
    expect((await screen.findByRole('alert')).textContent).toContain('sending messages quickly');
    apiMock.fn.mockRejectedValueOnce(new ApiClientError(500, 'x', 'INTERNAL'));
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not answer');
    apiMock.fn.mockResolvedValueOnce(answer({ topic: 'team', answer: 'Email the team.' }));
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await screen.findByText('Email the team.');
  });

  it('offline: keeps the draft, disables sending, and says so', async () => {
    mount();
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    fireEvent.change(textbox(), { target: { value: 'Will this keep?' } });
    expect(screen.getByText(/Offline\. Your draft stays here/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(textbox(), { key: 'Enter' });
    expect(apiMock.fn).not.toHaveBeenCalled();
    expect(textbox().value).toBe('Will this keep?');
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('docks bottom-right past the hero with the same input, draft and focus, and comes back', async () => {
    const { container } = mount();
    const input = textbox();
    input.focus();
    fireEvent.change(input, { target: { value: 'half-typed question' } });
    const slot = screen.getByTestId('slot');
    scrollPastHero(slot);
    const root = container.querySelector('.zev-ask')!;
    expect(root.className).toContain('is-docked');
    // The same node, still inside the slot, which keeps its height so the page does not jump.
    expect(root.parentElement).toBe(slot);
    expect(slot.style.minHeight).not.toBe('');
    expect(root.getAttribute('data-state')).toBe('docked-open');
    expect(textbox()).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('half-typed question');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText(/moved to the bottom-right corner/)).toBeTruthy();
    expect(await violations(container)).toEqual([]);

    // Escape minimizes to the launcher and moves focus there; the input stays mounted.
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(root.getAttribute('data-state')).toBe('docked-closed');
    const launcher = screen.getByRole('button', { name: 'Ask Zev' });
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(launcher);
    expect(container.querySelectorAll('textarea')).toHaveLength(1);

    scrollBackToHero(slot);
    expect(root.className).toContain('is-hero');
    expect(slot.style.minHeight).toBe('');
    expect(textbox()).toBe(input);
    expect(input.value).toBe('half-typed question');
  });

  it('docks collapsed when the visitor was not using it, and opens from the launcher', async () => {
    const { container } = mount();
    scrollPastHero(screen.getByTestId('slot'));
    expect(container.querySelector('.zev-ask')?.getAttribute('data-state')).toBe('docked-closed');
    fireEvent.click(screen.getByRole('button', { name: 'Ask Zev' }));
    expect(container.querySelector('.zev-ask')?.getAttribute('data-state')).toBe('docked-open');
    expect(screen.getByRole('button', { name: 'Minimize Ask Zev' })).toBeTruthy();
  });

  it('marks the launcher when a real answer lands while minimized', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    apiMock.fn.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    mount();
    textbox().focus();
    fireEvent.click(screen.getByRole('button', { name: 'What does ZEVQORA do?' }));
    scrollPastHero(screen.getByTestId('slot'));
    fireEvent.click(screen.getByRole('button', { name: 'Minimize Ask Zev' }));
    await act(async () => resolve(answer()));
    expect(screen.getByRole('button', { name: /Continue with Zev.*new answer/ })).toBeTruthy();
  });
});

describe('section suggestions', () => {
  const dwell = async (selector: string) => {
    const el = document.querySelector(selector)!;
    fire(el, { isIntersecting: true, intersectionRatio: 0.8 });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    return el;
  };

  it('offers at most two per session, each dismissible, never as a message in the thread', async () => {
    vi.useFakeTimers();
    mount(true);
    scrollPastHero(screen.getByTestId('slot'));

    const product = await dwell('#product');
    const first = screen.getByRole('complementary', { name: 'Suggestion from Ask Zev' });
    expect(first.textContent).toContain('How do I connect my server?');
    expect(screen.queryByRole('log')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggestion' }));
    expect(screen.queryByRole('complementary', { name: 'Suggestion from Ask Zev' })).toBeNull();
    fire(product, { isIntersecting: false, intersectionRatio: 0 });

    const proof = await dwell('#proof');
    expect(screen.getByRole('complementary', { name: 'Suggestion from Ask Zev' }).textContent).toContain('Why verify before optimizing?');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggestion' }));
    fire(proof, { isIntersecting: false, intersectionRatio: 0 });

    await dwell('.engine-home-pricing');
    expect(screen.queryByRole('complementary', { name: 'Suggestion from Ask Zev' })).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem('zevqora.askzev.suggestions.v1') || '[]')).toHaveLength(MAX_SUGGESTIONS_PER_SESSION);
    expect(apiMock.fn).not.toHaveBeenCalled();
  });

  it('accepting fills the draft and opens the panel without sending', async () => {
    vi.useFakeTimers();
    mount(true);
    scrollPastHero(screen.getByTestId('slot'));
    await dwell('.engine-boundaries');
    fireEvent.click(screen.getByRole('button', { name: /Ask “What happens to my data\?”/ }));
    expect(textbox().value).toBe('What happens to my data?');
    expect(apiMock.fn).not.toHaveBeenCalled();
  });

  it('respects the session cap across page loads', async () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem('zevqora.askzev.suggestions.v1', JSON.stringify(['product', 'proof']));
    mount(true);
    scrollPastHero(screen.getByTestId('slot'));
    await dwell('.engine-home-pricing');
    expect(screen.queryByRole('complementary', { name: 'Suggestion from Ask Zev' })).toBeNull();
  });

  it('stays quiet while the panel is open or the hero is on screen', async () => {
    vi.useFakeTimers();
    mount(true);
    await dwell('#product');
    expect(screen.queryByRole('complementary', { name: 'Suggestion from Ask Zev' })).toBeNull();
  });
});

describe('dimensional Z mark', () => {
  const setMatchMedia = (matches: (q: string) => boolean) => {
    window.matchMedia = ((q: string) => ({ matches: matches(q), media: q, addEventListener() {}, removeEventListener() {}, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  };

  it('is decorative and built from the canonical path', async () => {
    const { DimensionalZ } = await import('@/brand/DimensionalZ');
    const { MARK_PATH } = await import('@/brand/marks');
    setMatchMedia(() => false);
    const { container } = render(<DimensionalZ size={200} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    const paths = Array.from(container.querySelectorAll('path')).map((p) => p.getAttribute('d'));
    expect(paths.length).toBeGreaterThan(10);
    expect(paths.every((d) => d === MARK_PATH)).toBe(true);
  });

  it('reduced motion: a still object with no pointer listeners', async () => {
    const { DimensionalZ } = await import('@/brand/DimensionalZ');
    setMatchMedia((q) => q.includes('reduce'));
    const add = vi.spyOn(window, 'addEventListener');
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { container } = render(<DimensionalZ size={200} />);
    expect((container.firstElementChild as HTMLElement).dataset.motion).toBe('static');
    expect(add.mock.calls.map((c) => c[0])).not.toContain('pointermove');
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10, pointerType: 'mouse' });
    expect(raf).not.toHaveBeenCalled();
  });

  it('does not animate while offscreen or while the tab is hidden', async () => {
    const { DimensionalZ } = await import('@/brand/DimensionalZ');
    setMatchMedia((q) => q.includes('pointer: fine'));
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const { container } = render(<DimensionalZ size={200} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.motion).toBe('live');
    const move = () => window.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 400, clientY: 50 }));
    move();
    expect(raf).toHaveBeenCalledTimes(1);

    raf.mockClear();
    fire(root, { isIntersecting: false });
    move();
    expect(raf).not.toHaveBeenCalled();

    fire(root, { isIntersecting: true });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    move();
    expect(raf).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  it('touch never blocks scrolling: pan-y and passive listeners only', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, '../src/styles/home-ask-zev.css'), 'utf8');
    expect(css).toMatch(/\.zev-dimensional \{[^}]*touch-action: pan-y/);
    const src = readFileSync(resolve(__dirname, '../src/brand/DimensionalZ.tsx'), 'utf8');
    expect(src).not.toMatch(/\.preventDefault\(/);
    expect(src).not.toMatch(/passive: false/);
  });
});
