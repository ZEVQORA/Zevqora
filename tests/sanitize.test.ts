import { describe, expect, it } from 'vitest';
import { redactSecrets, sanitizeSample, sanitizeMetadata, promptHashFromMessages } from '../api/_lib/sanitize.js';

describe('sanitize', () => {
  it('redacts known secret shapes', () => {
    const text = 'key sk-abcdefghijklmnopqrstuvwxyz123456 and Bearer abcdefghijklmnopqrstuvwxyz and AKIAABCDEFGHIJKLMNOP';
    const out = redactSecrets(text);
    expect(out).not.toContain('sk-abcdef');
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(out).not.toMatch(/Bearer abcdef/);
  });

  it('keeps only role/content text and caps size', () => {
    const sample = sanitizeSample({
      messages: [
        { role: 'system', content: 'You are helpful. api key sk-or-v1-abcdefghijklmnopqrstuvwxyz' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'data:...' } }] },
        { role: 'tool', content: 'ignored' },
      ],
      output: 'x'.repeat(20000),
      response_format: { type: 'json_object', schema: { huge: true } },
    });
    expect(sample?.messages).toHaveLength(2);
    expect(sample?.messages[0].content).toContain('[redacted]');
    expect(sample?.messages[1].content).toBe('hello');
    expect(sample?.output.length).toBeLessThan(9000);
    expect(sample?.response_format).toEqual({ type: 'json_object' });
    expect(sanitizeSample(null)).toBeNull();
    expect(sanitizeSample({ messages: [] })).toBeNull();
  });

  it('drops sensitive metadata keys and non-scalar values', () => {
    const meta = sanitizeMetadata({ route: '/chat', api_key: 'secret', Authorization: 'x', nested: { a: 1 }, retries: 2 });
    expect(meta).toEqual({ route: '/chat', retries: 2 });
  });

  it('hashes prompts deterministically regardless of key order', () => {
    const a = promptHashFromMessages([{ role: 'user', content: 'hi' }]);
    const b = promptHashFromMessages([{ content: 'hi', role: 'user' }]);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(promptHashFromMessages([])).toBeNull();
  });
});
