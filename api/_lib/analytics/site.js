/**
 * Cookieless first-party website analytics: request → privacy-safe row.
 *
 * Kept: normalized path (no query, no fragment, no ids or tokens), referrer
 * host only, UTM tags, approximate country/region from the edge, device and
 * browser family, a per-tab session id and a daily-rotating visitor key.
 * Never kept: IP address, full user agent, full referrer URL, query strings.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { clientIp } from '../http.js';

const PROCESS_SECRET = randomBytes(32).toString('hex');

/** The daily HMAC secret. Without ANALYTICS_SECRET each server instance uses its own, which over-counts visitors. */
export function analyticsSecretConfigured() {
  return Boolean(process.env.ANALYTICS_SECRET && process.env.ANALYTICS_SECRET.length >= 32);
}
function secret() {
  return analyticsSecretConfigured() ? process.env.ANALYTICS_SECRET : PROCESS_SECRET;
}

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** HMAC(secret, day | ip | ua). Rotates at UTC midnight; cannot be reversed or joined across days. */
export function visitorKey(ip, userAgent, day = utcDay()) {
  return createHmac('sha256', secret()).update(`${day}|${ip || ''}|${userAgent || ''}`).digest('hex');
}

const SENSITIVE_PREFIXES = [
  [/^\/invite\/[^/]+/, '/invite/:token'],
  [/^\/reset-password.*/, '/reset-password'],
  [/^\/auth\/callback.*/, '/auth/callback'],
  [/^\/desktop-auth.*/, '/desktop-auth'],
];
const ID_SEGMENT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,}|\d{4,})$/i;

/** Path without query/fragment; ids, tokens and long opaque segments become `:id`. */
export function normalizePath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  let path = raw.split(/[?#]/)[0].replace(/\/{2,}/g, '/');
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (/[\s<>"'`\\]/.test(path)) return null;
  for (const [re, to] of SENSITIVE_PREFIXES) if (re.test(path)) return to;
  path = path
    .split('/')
    .map((seg) => (ID_SEGMENT.test(seg) ? ':id' : seg.toLowerCase()))
    .join('/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path.slice(0, 200) || '/';
}

/** Host of an external referrer; own host and unparsable values are dropped. */
export function referrerHost(referrer, ownHost) {
  if (!referrer || typeof referrer !== 'string') return null;
  try {
    const u = new URL(referrer);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (ownHost && host === String(ownHost).toLowerCase().replace(/^www\./, '')) return null;
    return host.slice(0, 120) || null;
  } catch {
    return null;
  }
}

const UTM = /^[A-Za-z0-9 _.+-]{1,100}$/;
export function utm(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return UTM.test(v) ? v : null;
}

const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|curl|wget|python-requests|httpclient|axios|node-fetch/i;

export function classifyAgent(userAgent) {
  const ua = String(userAgent || '');
  if (!ua || BOT.test(ua)) return { device: 'bot', browser: 'bot', bot: true };
  const tablet = /iPad|Tablet|Nexus 7|Nexus 10|SM-T|Kindle|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const mobile = !tablet && /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const browser = /Edg\//.test(ua) ? 'edge' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\/|CriOS\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
  return { device: tablet ? 'tablet' : mobile ? 'mobile' : /Windows|Macintosh|X11|Linux/.test(ua) ? 'desktop' : 'unknown', browser, bot: false };
}

/** Approximate geography from the hosting edge. Never derived from a stored IP. */
export function edgeGeo(request) {
  const country = (request.headers.get('x-vercel-ip-country') || '').toUpperCase();
  const regionRaw = request.headers.get('x-vercel-ip-country-region') || '';
  return {
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    region: /^[A-Za-z0-9 _.-]{1,64}$/.test(regionRaw) ? regionRaw : null,
  };
}

/** Do Not Track / Global Privacy Control: the visitor asked not to be counted. */
export function optedOut(request) {
  return request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1';
}

export const SITE_EVENTS = Object.freeze(['pageview', 'cta_click', 'signup_started', 'evaluation_submitted', 'outbound_click']);
const CTA = /^[a-z0-9][a-z0-9_.-]{0,59}$/;
const SESSION = /^[A-Za-z0-9]{8,64}$/;

/** Builds the row to store, or null when the payload is not a valid website event. */
export function siteEventRow(request, body) {
  const event = typeof body?.event === 'string' ? body.event : '';
  if (!SITE_EVENTS.includes(event)) return null;
  const path = normalizePath(body?.path);
  if (!path) return null;
  const session = typeof body?.session_id === 'string' && SESSION.test(body.session_id) ? body.session_id : null;
  if (!session) return null;
  const ua = request.headers.get('user-agent') || '';
  const agent = classifyAgent(ua);
  const own = (() => {
    try {
      return new URL(request.url).hostname;
    } catch {
      return null;
    }
  })();
  const { country, region } = edgeGeo(request);
  return {
    event,
    path,
    referrer_host: referrerHost(body?.referrer, own),
    utm_source: utm(body?.utm?.source),
    utm_medium: utm(body?.utm?.medium),
    utm_campaign: utm(body?.utm?.campaign),
    cta: typeof body?.cta === 'string' && CTA.test(body.cta) ? body.cta : null,
    country,
    region,
    device: agent.device,
    browser: agent.browser,
    session_id: session,
    visitor_key: visitorKey(clientIp(request), ua),
    is_bot: agent.bot,
  };
}
