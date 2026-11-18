import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { zevModel } from '../api/_lib/zev-model.js';
import { forwardChatCompletion } from '../api/_lib/openrouter.js';

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({
  requireUser: async () => ({ user: { id: 'user-free' }, admin: {} }),
  requireWorkspaceRole: vi.fn(),
  rateLimit: vi.fn(),
  rateLimitRequest: vi.fn(),
}));
vi.mock('../api/_lib/platform-compute.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveBilling: async () => ({}),
  completeText: mocks.complete,
}));

let dispatch: (request: Request) => Promise<Response>;
beforeAll(async () => {
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/engine.js');
});
beforeEach(() => {
  vi.stubEnv('ENGINEERING_ZEV_PROVIDER', 'openrouter');
  vi.stubEnv('ENGINEERING_ZEV_MODEL', 'openrouter/free');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-free-key');
  vi.stubEnv('ANTHROPIC_API_KEY', 'obsolete-test-key');
  mocks.complete.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('free Engineering Zev', () => {
  it('reports OpenRouter and the configured free model even with a legacy Claude key', async () => {
    const response = await dispatch(new Request('https://test.local/api/engine/health'));
    expect(await response.json()).toMatchObject({ engineering_zev_provider: 'openrouter', engineering_zev_model: 'openrouter/free' });
  });

  it('ignores a paid client override and keeps the free router across tool calls', async () => {
    mocks.complete
      .mockResolvedValueOnce({ content: null, model: 'example/resolved-model', toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'workspace_summary', arguments: '{}' } }] })
      .mockResolvedValueOnce({ content: 'Ready to help.', model: 'example/resolved-model', toolCalls: [] });
    const response = await dispatch(new Request('https://test.local/api/engine/agent/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'anthropic/claude-opus-5-5', messages: [{ role: 'user', content: 'Help me get started' }] }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: 'Ready to help.', provider: 'zevqora-platform', provider_configured: true });
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    for (const [args] of mocks.complete.mock.calls) expect(args.payload.model).toBe('openrouter/free');
    expect(mocks.complete.mock.calls[1][0].payload.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1' });
  });

  it('accepts free catalog variants and replaces paid or invalid server config', () => {
    for (const value of ['anthropic/claude-opus-5-5', 'openrouter/auto', 'invalid']) {
      vi.stubEnv('ENGINEERING_ZEV_MODEL', value);
      expect(zevModel()).toBe('openrouter/free');
    }
    vi.stubEnv('ENGINEERING_ZEV_MODEL', 'qwen/qwen3-coder:free');
    expect(zevModel()).toBe('qwen/qwen3-coder:free');
  });

  it('enforces zero token pricing and disables optional reasoning in free requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Hello' } }], usage: { cost: 0 } })));
    vi.stubGlobal('fetch', fetchMock);
    await forwardChatCompletion({ model: 'openrouter/free', messages: [{ role: 'user', content: 'Hello' }] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.provider.max_price).toEqual({ prompt: 0, completion: 0 });
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.models).toBeUndefined();
  });

  it('rejects provider errors wrapped in HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 429, message: 'Rate limited' } }))));
    await expect(forwardChatCompletion({ model: 'openrouter/free', messages: [{ role: 'user', content: 'Hello' }] })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});
