import { ApiError, json } from './http.js';

const routes = [];

function compile(pattern) {
  const parts = pattern.split('/').filter(Boolean);
  return { parts, keys: parts.map((p) => (p.startsWith(':') ? p.slice(1) : null)) };
}

/** Registers a route. Patterns are absolute (`/api/...`) and support `:param` segments. */
export function on(method, pattern, handler) {
  routes.push({ method: method.toUpperCase(), ...compile(pattern), handler, pattern });
}

export function match(method, pathname) {
  const segments = pathname.split('/').filter(Boolean);
  let allowed = [];
  for (const route of routes) {
    if (route.parts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < route.parts.length; i += 1) {
      const key = route.keys[i];
      if (key) params[key] = decodeURIComponent(segments[i]);
      else if (route.parts[i] !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (route.method === method) return { route, params };
    allowed.push(route.method);
  }
  return allowed.length ? { allowed } : null;
}

export async function dispatch(request) {
  const url = new URL(request.url);
  // Vercel routes every /api/* request to this single function through a
  // rewrite that carries the original path in `__path`. Restore it so handlers
  // see the public route, and strip it from the query string.
  const forwarded = url.searchParams.get('__path');
  if (forwarded !== null) {
    url.pathname = '/api/' + forwarded.replace(/^\/+/, '');
    url.searchParams.delete('__path');
  }
  const method = request.method.toUpperCase();
  const found = match(method, url.pathname);
  try {
    if (!found) throw new ApiError(404, 'Not found.', 'NOT_FOUND');
    if (found.allowed) {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: found.allowed.join(', ') } });
      throw new ApiError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
    }
    const ctx = { request, url, params: found.params, query: url.searchParams };
    const result = await found.route.handler(ctx);
    if (result instanceof Response) return result;
    return json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: error.message, code: error.code || null, ...(error.extra ? { details: error.extra } : {}) }, error.status);
    }
    // Never echo provider/database internals. Log server-side with the route only.
    console.error(`[api] ${method} ${url.pathname}`, error?.message || error);
    return json({ error: 'Something went wrong on our side. Please retry.', code: 'INTERNAL' }, 500);
  }
}

export function resetRoutesForTests() {
  routes.length = 0;
}
