import { afterAll, afterEach, describe, expect, it } from "@jest/globals";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { createApp } from "../../src/app.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test")
  throw new Error("A-01 tests require dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient();
const secret = "an-http-test-token-secret-longer-than-32-bytes";
const now = new Date("2026-11-03T00:00:00.000Z");

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createServer(createApp({ db: prisma, tokenSecret: secret, now: () => now }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
  try {
    return await run(`http://127.0.0.1:${address.port}/api/v1`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function register(baseUrl: string) {
  const email = `a01-sec-${randomUUID()}@example.invalid`;
  createdEmails.add(email);
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Validpass123", role: Role.CLIENT, termsVersion: "terms-2026-01" }),
  });
  expect(response.status).toBe(201);
  const data = (await response.json() as { data: { user: { id: string }; accessToken: string } }).data;
  createdIds.add(data.user.id);
  return data;
}

function me(baseUrl: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}/me`, { headers: { authorization: `Bearer ${token}` } });
}

const createdEmails = new Set<string>();
const createdIds = new Set<string>();

describe("A-01 access-token lifecycle and isolation", () => {
  afterAll(async () => prisma.$disconnect());
  afterEach(async () => {
    for (const id of createdIds) {
      const user = await prisma.user.findUnique({ where: { id } });
      if (user) await prisma.user.delete({ where: { id } });
    }
    for (const email of createdEmails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) await prisma.user.delete({ where: { id: user.id } });
    }
    createdIds.clear();
    createdEmails.clear();
  });

  it("scopes /me to the bearer caller and never exposes another account", async () => {
    await withServer(async baseUrl => {
      const first = await register(baseUrl);
      const second = await register(baseUrl);

      const firstMe = await me(baseUrl, first.accessToken);
      const secondMe = await me(baseUrl, second.accessToken);
      expect(firstMe.status).toBe(200);
      expect(secondMe.status).toBe(200);

      const firstId = (await firstMe.json() as { data: { id: string } }).data.id;
      const secondId = (await secondMe.json() as { data: { id: string } }).data.id;
      expect(firstId).toBe(first.user.id);
      expect(secondId).toBe(second.user.id);
      expect(firstId).not.toBe(secondId);
    });
  });

  it("rejects an already-issued access token once the account is suspended or withdrawn", async () => {
    await withServer(async baseUrl => {
      const account = await register(baseUrl);
      expect((await me(baseUrl, account.accessToken)).status).toBe(200);

      await prisma.user.update({ where: { id: account.user.id }, data: { suspendedAt: now } });
      expect((await me(baseUrl, account.accessToken)).status).toBe(403);

      await prisma.user.update({ where: { id: account.user.id }, data: { suspendedAt: null } });
      const withdrawn = await fetch(`${baseUrl}/me`, { method: "DELETE", headers: { authorization: `Bearer ${account.accessToken}` } });
      expect(withdrawn.status).toBe(200);
      expect((await me(baseUrl, account.accessToken)).status).toBe(403);
    });
  });
});
