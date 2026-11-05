/**
 * Vercel Function entry for /api/v1/*.
 *
 * The Express app is created once at module scope so PrismaClient and ports are
 * reused across invocations on the same function instance. Vercel may strip the
 * function prefix from req.url; normalize it back to /api/v1/* before Express.
 */
import { createServerApp } from '../../dist/server-app.js';

const { app } = createServerApp();

export default function handler(req, res) {
  const url = typeof req.url === 'string' && req.url.length > 0 ? req.url : '/';
  if (!url.startsWith('/api/v1')) {
    req.url = `/api/v1${url.startsWith('/') ? '' : '/'}${url}`;
  }
  return app(req, res);
}
