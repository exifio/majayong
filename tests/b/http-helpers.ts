/** 테스트용 HTTP 하네스: 임의 포트로 앱을 띄우고 fetch로 호출한다. */
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';

export interface HttpResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

export async function withServer(
  app: Express,
  run: (call: (input: {
    readonly method: string;
    readonly path: string;
    readonly token?: string;
    readonly body?: unknown;
  }) => Promise<HttpResult>) => Promise<void>,
): Promise<void> {
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    await run(async (input) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (input.token !== undefined) headers.authorization = `Bearer ${input.token}`;
      if (input.method === 'GET') delete headers['content-type'];
      const response = await fetch(`${base}${input.path}`, {
        method: input.method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      });
      const textBody = await response.text();
      return {
        status: response.status,
        body: textBody.length === 0 ? null : (JSON.parse(textBody) as unknown),
        headers: response.headers,
      };
    });
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}
