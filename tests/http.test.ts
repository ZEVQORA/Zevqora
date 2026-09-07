import { describe, expect, it } from 'vitest';
import { slugify, str, num, uuid, readJson, ApiError } from '../api/_lib/http.js';

describe('http helpers', () => {
  it('slugifies names safely', () => {
    expect(slugify('Acme AI  Team!')).toBe('acme-ai-team');
    expect(slugify('')).toBe('workspace');
    expect(slugify('x')).toBe('workspace');
  });

  it('validates strings, numbers and ids', () => {
    expect(str('  hello ', { max: 10 })).toBe('hello');
    expect(() => str('toolong', { max: 3 })).toThrow(ApiError);
    expect(() => str('', { required: true })).toThrow(ApiError);
    expect(num('4', { min: 0, max: 10 })).toBe(4);
    expect(() => num('x')).toThrow(ApiError);
    expect(() => num(1.5, { integer: true })).toThrow(ApiError);
    expect(uuid('4C9C1A2E-8E6A-4A6B-9B3E-1D2F3A4B5C6D')).toBe('4c9c1a2e-8e6a-4a6b-9b3e-1d2f3a4b5c6d');
    expect(() => uuid('nope')).toThrow(ApiError);
  });

  it('limits and parses bodies', async () => {
    const ok = await readJson(new Request('https://x.test', { method: 'POST', body: '{"a":1}' }));
    expect(ok).toEqual({ a: 1 });
    await expect(readJson(new Request('https://x.test', { method: 'POST', body: 'nope' }))).rejects.toThrow(ApiError);
    await expect(readJson(new Request('https://x.test', { method: 'POST', body: 'x'.repeat(100) }), { maxBytes: 10 })).rejects.toThrow(ApiError);
  });
});
