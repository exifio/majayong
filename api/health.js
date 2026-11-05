import { randomUUID } from 'node:crypto';

/**
 * Vercel health endpoint. Kept independent of the Express bundle so healthchecks
 * stay cheap and do not initialize Prisma.
 */
export default function handler(req, res) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  res.statusCode = 200;
  res.setHeader('x-request-id', requestId);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ data: { status: 'ok' } }));
}
