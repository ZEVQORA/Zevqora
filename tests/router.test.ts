import { describe, expect, it, beforeEach } from 'vitest';
import { on, match, dispatch, resetRoutesForTests } from '../api/_lib/router.js';
import { ApiError } from '../api/_lib/http.js';

describe('router', () => {
  beforeEach(() => resetRoutesForTests());

  it('matches params and methods', () => {
    on('GET', '/api/projects/:id/runtime', () => ({}));
    on('POST', '/api/projects/:id/analyze', () => ({}));
    const found = match('GET', '/api/projects/abc-123/runtime');
    expect(found?.params).toEqual({ id: 'abc-123' });
    expect(match('GET', '/api/projects/abc/analyze')).toEqual({ allowed: ['POST'] });
    expect(match('GET', '/api/nothing')).toBeNull();
  });

  it('dispatches JSON, 404, 405 and hides internal errors', async () => {
    on('GET', '/api/ok', () => ({ ok: true }));
    on('GET', '/api/boom', () => {
      throw new Error('database password leaked');
    });
    on('GET', '/api/api-error', () => {
      throw new ApiError(402, 'Need credits', 'INSUFFICIENT_CREDITS');
    });
    const ok = await dispatch(new Request('https://x.test/api/ok'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const missing = await dispatch(new Request('https://x.test/api/missing'));
    expect(missing.status).toBe(404);
    const wrong = await dispatch(new Request('https://x.test/api/ok', { method: 'POST' }));
    expect(wrong.status).toBe(405);
    const boom = await dispatch(new Request('https://x.test/api/boom'));
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain('password');
    const apiErr = await dispatch(new Request('https://x.test/api/api-error'));
    expect(apiErr.status).toBe(402);
    expect((await apiErr.json()).code).toBe('INSUFFICIENT_CREDITS');
  });
});
