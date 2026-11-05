/**
 * Vercel Function entry for /api/v1/*.
 *
 * Vercel's file-based router treats `[...path]` as one dynamic segment, so
 * `/api/v1/auth/login`-style routes would 404. vercel.json rewrites
 * `/api/v1/:path*` here with the original path in `?path=`, which we restore
 * before handing the request to Express.
 */
import { createServerApp } from '../../dist/server-app.js';

const { app } = createServerApp();

function restorePath(req) {
  const raw = typeof req.url === 'string' && req.url.length > 0 ? req.url : '/';
  const parsed = new URL(raw, 'http://local');
  const forwarded = parsed.searchParams.getAll('path');
  if (forwarded.length === 0) return raw;
  parsed.searchParams.delete('path');
  const query = parsed.searchParams.toString();
  return `/api/v1/${forwarded.join('/')}${query ? `?${query}` : ''}`;
}

export default function handler(req, res) {
  req.url = restorePath(req);
  return app(req, res);
}
