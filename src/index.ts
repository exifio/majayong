import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { renderCatalog } from './lib/catalog.js';
import { renderScreen, WEB_ROOT } from './lib/page.js';
import { screens } from './screens/index.js';

const PORT = Number(process.env.PORT ?? 3000);
const byRoute = new Map(screens.map((s) => [s.id === 'Main' ? '/' : `/${s.id}`, s]));

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, cache = 'no-cache') {
  res.writeHead(status, { 'content-type': type, 'cache-control': cache });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
  try {
    if (path.startsWith('/assets/') && !path.includes('..')) {
      const file = await readFile(new URL(`.${path}`, WEB_ROOT)).catch(() => null);
      if (!file) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      return send(res, 200, MIME[extname(path)] ?? 'application/octet-stream', file, 'public, max-age=3600');
    }
    if (path === '/screens') return send(res, 200, 'text/html; charset=utf-8', renderCatalog(screens));
    const screen = byRoute.get(path);
    if (!screen) return send(res, 404, 'text/html; charset=utf-8', renderCatalog(screens));
    send(res, 200, 'text/html; charset=utf-8', await renderScreen(screen, url.searchParams));
  } catch (err) {
    console.error(err);
    send(res, 500, 'text/plain; charset=utf-8', 'Internal error');
  }
});

export default server;

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`마자용 running at http://localhost:${PORT}  (all screens: http://localhost:${PORT}/screens)`);
  });
}
