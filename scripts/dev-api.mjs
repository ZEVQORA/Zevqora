/**
 * Local API server for development: serves api/[...path].js over Node's http
 * with Web-standard Request/Response, the same contract Vercel uses.
 *
 *   node --env-file=.env.local scripts/dev-api.mjs      # http://127.0.0.1:3000
 *
 * Vite's dev server proxies /api to this port (see vite.config.ts).
 */
import http from 'node:http';
import { Readable } from 'node:stream';

const port = Number(process.env.PORT || 3000);
const mod = await import('../api/index.js');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
    const method = (req.method || 'GET').toUpperCase();
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const request = new Request(url, { method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: 'half' });
    const handler = mod[method] || mod.GET;
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (error) {
    console.error('[dev-api]', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'dev server error' }));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`[dev-api] listening on http://127.0.0.1:${port}`));
