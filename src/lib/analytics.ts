import { api } from './api';

/**
 * First-party, cookieless website analytics.
 *
 * - No cookies and no third-party script. A random id lives in sessionStorage
 *   and dies with the tab.
 * - Do Not Track / Global Privacy Control: nothing is sent.
 * - Only the path (no query or fragment), the referrer, UTM tags and an event
 *   name leave the browser; the server reduces the referrer to its host and
 *   never stores the IP address.
 * - Nothing from inside the product (prompts, traces, ids) is ever sent here.
 */
const SESSION_KEY = 'zevqora.analytics.session';
const UTM_KEY = 'zevqora.analytics.utm';

export function analyticsOptedOut() {
  if (typeof navigator === 'undefined') return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return nav.doNotTrack === '1' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl === true;
}

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id || !/^[A-Za-z0-9]{8,64}$/.test(id)) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** UTM tags from the landing URL, kept for the tab so later events stay attributed. */
function utm() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fresh = { source: params.get('utm_source'), medium: params.get('utm_medium'), campaign: params.get('utm_campaign') };
    if (fresh.source || fresh.medium || fresh.campaign) sessionStorage.setItem(UTM_KEY, JSON.stringify(fresh));
    const stored = sessionStorage.getItem(UTM_KEY);
    return stored ? (JSON.parse(stored) as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

let landingReferrer: string | null = typeof document !== 'undefined' ? document.referrer || null : null;

type SiteEvent = 'pageview' | 'cta_click' | 'signup_started' | 'evaluation_submitted' | 'outbound_click';

export function track(event: SiteEvent, extra: { cta?: string; path?: string } = {}) {
  if (typeof window === 'undefined' || analyticsOptedOut()) return;
  const sid = sessionId();
  if (!sid) return;
  const body = JSON.stringify({ event, path: extra.path || window.location.pathname, session_id: sid, referrer: landingReferrer, utm: utm(), cta: extra.cta });
  // The external referrer only describes how the session started.
  if (event === 'pageview') landingReferrer = null;
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/analytics/collect', blob)) return;
  } catch {
    /* fall through to fetch */
  }
  void fetch('/api/analytics/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
}

/** Paths whose views count as website traffic. Product and admin screens never do. */
export function isWebsitePath(pathname: string) {
  return !/^\/(app|admin|desktop-auth|auth\/callback|reset-password|invite)(\/|$)/.test(pathname);
}

/** Clicks on any element with data-cta="name" are recorded as CTA clicks (website only). */
export function installCtaTracking() {
  if (typeof document === 'undefined') return () => undefined;
  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-cta]') as HTMLElement | null;
    if (!el || !isWebsitePath(window.location.pathname)) return;
    const name = el.dataset.cta || '';
    if (/^[a-z0-9][a-z0-9_.-]{0,59}$/.test(name)) track('cta_click', { cta: name });
  };
  document.addEventListener('click', onClick, { capture: true });
  return () => document.removeEventListener('click', onClick, { capture: true });
}

/** Product view events (allow-listed server-side, recorded once per user, subject and day). */
export function trackProductView(event: 'diagnosis_viewed' | 'pareto_viewed' | 'report_opened', workspaceId: string, subjectId?: string, properties: Record<string, string | number | boolean> = {}) {
  void api('/api/analytics/product-event', { method: 'POST', body: { event, workspace_id: workspaceId, subject_id: subjectId, properties } }).catch(() => undefined);
}
