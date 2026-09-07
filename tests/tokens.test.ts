import { describe, expect, it } from 'vitest';
import { generateConnectionToken, parseConnectionToken, sha256, safeEqual, generateInviteToken } from '../api/_lib/tokens.js';

describe('connection tokens', () => {
  it('generates high-entropy tokens whose hash matches on parse', () => {
    const t = generateConnectionToken();
    expect(t.token.startsWith('zqt_')).toBe(true);
    expect(t.token.length).toBeGreaterThan(50);
    const parsed = parseConnectionToken(t.token);
    expect(parsed?.prefix).toBe(t.prefix);
    expect(parsed?.hash).toBe(t.hash);
    expect(t.hash).toBe(sha256(t.token));
    expect(t.last4).toBe(t.token.slice(-4));
  });

  it('rejects malformed tokens and never collides', () => {
    expect(parseConnectionToken('zqt_short')).toBeNull();
    expect(parseConnectionToken('')).toBeNull();
    expect(parseConnectionToken('Bearer zqt_abc')).toBeNull();
    const a = generateConnectionToken();
    const b = generateConnectionToken();
    expect(a.token).not.toBe(b.token);
    expect(safeEqual(a.hash, a.hash)).toBe(true);
    expect(safeEqual(a.hash, b.hash)).toBe(false);
  });

  it('invite tokens hash consistently', () => {
    const { token, hash } = generateInviteToken();
    expect(sha256(token)).toBe(hash);
  });
});
