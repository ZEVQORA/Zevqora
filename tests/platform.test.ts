import { describe, expect, it } from 'vitest';
import { validateCompletionRequest, rpmForPlan, MAX_OUTPUT_TOKENS, MAX_MESSAGES } from '../api/_lib/platform-guard.js';
import { ApiError } from '../api/_lib/http.js';

const base = { model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] };

describe('platform completion guard', () => {
  it('normalizes a minimal request and forces non-streaming accounted calls', () => {
    const { payload } = validateCompletionRequest({ ...base, stream: false });
    expect(payload.model).toBe('openai/gpt-4o-mini');
    expect(payload.stream).toBe(false);
    expect(payload.usage).toEqual({ include: true });
    expect(payload.max_tokens).toBe(1024);
    expect(payload.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('refuses streaming, bad roles and malformed models', () => {
    expect(() => validateCompletionRequest({ ...base, stream: true })).toThrow(ApiError);
    expect(() => validateCompletionRequest({ ...base, messages: [{ role: 'hacker', content: 'x' }] })).toThrow(ApiError);
    expect(() => validateCompletionRequest({ ...base, model: 'not a model!' })).toThrow(ApiError);
    expect(() => validateCompletionRequest({ ...base, messages: [] })).toThrow(ApiError);
    expect(() => validateCompletionRequest({ ...base, messages: Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })) })).toThrow(ApiError);
  });

  it('caps output tokens and temperature', () => {
    const { payload } = validateCompletionRequest({ ...base, max_tokens: 999999, temperature: 9 });
    expect(payload.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(payload.temperature).toBe(2);
  });

  it('drops unknown fields and keeps tool calls well-formed', () => {
    const { payload } = validateCompletionRequest({
      ...base,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'scan', arguments: { product_id: 'x' } } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
        { role: 'user', content: [{ type: 'text', text: 'and now?' }] },
      ],
      tools: [{ type: 'function', function: { name: 'scan', description: 'd', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
      response_format: { type: 'json_object' },
      provider: { order: ['evil'] },
      transforms: ['x'],
    } as unknown as Record<string, unknown>);
    expect((payload as Record<string, unknown>).provider).toBeUndefined();
    expect((payload as Record<string, unknown>).transforms).toBeUndefined();
    expect(payload.messages[1].tool_calls[0].function.arguments).toBe('{"product_id":"x"}');
    expect(payload.messages[3].content).toBe('and now?');
    expect(payload.tools).toHaveLength(1);
    expect(payload.response_format).toEqual({ type: 'json_object' });
  });

  it('rejects non-text content parts and tool messages without ids', () => {
    expect(() => validateCompletionRequest({ ...base, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] })).toThrow(ApiError);
    expect(() => validateCompletionRequest({ ...base, messages: [{ role: 'tool', content: 'x' }] })).toThrow(ApiError);
  });

  it('derives rate limits from plan limits with sane defaults', () => {
    expect(rpmForPlan('free')).toBe(20);
    expect(rpmForPlan('starter')).toBe(60);
    expect(rpmForPlan('pro')).toBe(120);
    expect(rpmForPlan('pro', { platform_rpm: 30 })).toBe(30);
    expect(rpmForPlan('pro', { platform_rpm: 99999 })).toBe(600);
  });
});
