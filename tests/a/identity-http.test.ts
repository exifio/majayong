import { afterAll, afterEach, describe, expect, it, jest } from "@jest/globals";
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

async function withServer<T>(options: Parameters<typeof createApp>[0], run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createServer(createApp(options));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
  try {
    return await run(`http://127.0.0.1:${address.port}/api/v1`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function json(baseUrl: string, path: string, body?: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function register(baseUrl: string, email = `a01-http-${randomUUID()}@example.invalid`) {
  createdEmails.add(email);
  const response = await json(baseUrl, "/auth/register", {
    email,
    password: "Validpass123",
    role: Role.CLIENT,
    termsVersion: "terms-2026-01",
  });
  expect(response.status).toBe(201);
  const data = (await response.json() as { data: { user: { id: string }; accessToken: string; refreshToken: string } }).data;
  createdIds.add(data.user.id);
  return data;
}

const createdEmails = new Set<string>();
const createdIds = new Set<string>();

describe("A-01 HTTP identity API", () => {
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

  it("registers, logs in, and requires Bearer access for the caller's own account", async () => {
    await withServer({ db: prisma, tokenSecret: secret, now: () => now }, async baseUrl => {
      const account = await register(baseUrl);
      const rejected = await json(baseUrl, "/me");
      expect(rejected.status).toBe(401);
      const rejectedBody = await rejected.json() as { error: { requestId: string } };
      expect(rejectedBody.error.requestId).toBe(rejected.headers.get("x-request-id"));

      const bypass = await fetch(`${baseUrl}/me`, { headers: { "x-user-id": account.user.id, "x-user-role": "CLIENT" } });
      expect(bypass.status).toBe(401);
      const me = await fetch(`${baseUrl}/me`, { headers: { authorization: `Bearer ${account.accessToken}` } });
      expect(me.status).toBe(200);
      expect((await me.json() as { data: { id: string; email: string; role: Role } }).data).toMatchObject({
        id: account.user.id,
        role: Role.CLIENT,
      });

      const wrongPassword = await json(baseUrl, "/auth/login", {
        email: (await prisma.user.findUniqueOrThrow({ where: { id: account.user.id } })).email,
        password: "Wrongpass123",
      });
      expect(wrongPassword.status).toBe(401);

      const login = await json(baseUrl, "/auth/login", {
        email: (await prisma.user.findUniqueOrThrow({ where: { id: account.user.id } })).email,
        password: "Validpass123",
      });
      expect(login.status).toBe(200);
    });
  });

  it("returns unavailable for email flows when no delivery adapter is configured", async () => {
    await withServer({ db: prisma, tokenSecret: secret, now: () => now }, async baseUrl => {
      const response = await json(baseUrl, "/auth/password-reset/request", { email: "anyone@example.invalid" });
      expect(response.status).toBe(503);
      expect((await response.json() as { error: { code: string } }).error.code).toBe("DELIVERY_UNAVAILABLE");
    });
  });

  it("rotates refresh tokens, rejects replay, and ends the active session on logout", async () => {
    await withServer({ db: prisma, tokenSecret: secret, now: () => now }, async baseUrl => {
      const account = await register(baseUrl);
      const refreshed = await json(baseUrl, "/auth/refresh", { refreshToken: account.refreshToken });
      expect(refreshed.status).toBe(200);
      const rotated = (await refreshed.json() as { data: { refreshToken: string } }).data.refreshToken;
      const replay = await json(baseUrl, "/auth/refresh", { refreshToken: account.refreshToken });
      expect(replay.status).toBe(401);
      const current = await prisma.refreshSession.findUniqueOrThrow({ where: { tokenHash: (await import("node:crypto")).createHash("sha256").update(rotated).digest("hex") } });
      expect(current.revokedAt).not.toBeNull();
      const logout = await json(baseUrl, "/auth/logout", { refreshToken: rotated });
      expect(logout.status).toBe(200);
    });
  });

  it("sends a reset link without revealing account existence and consumes it once", async () => {
    let deliveredToken = "";
    const sendPasswordReset = jest.fn(async (_email: string, token: string) => { deliveredToken = token; });
    await withServer({ db: prisma, tokenSecret: secret, now: () => now, sendPasswordReset }, async baseUrl => {
      const account = await register(baseUrl);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: account.user.id } });
      const request = await json(baseUrl, "/auth/password-reset/request", { email: user.email });
      expect(request.status).toBe(200);
      expect(sendPasswordReset).toHaveBeenCalledTimes(1);
      const missing = await json(baseUrl, "/auth/password-reset/request", { email: "missing@example.invalid" });
      expect(missing.status).toBe(200);
      expect(await missing.json()).toEqual(await request.json());
      const confirm = await json(baseUrl, "/auth/password-reset/confirm", { token: deliveredToken, newPassword: "Anotherpass123" });
      expect(confirm.status).toBe(200);
      const reused = await json(baseUrl, "/auth/password-reset/confirm", { token: deliveredToken, newPassword: "Anotherpass123" });
      expect(reused.status).toBe(401);
      const login = await json(baseUrl, "/auth/login", { email: user.email, password: "Anotherpass123" });
      expect(login.status).toBe(200);
    });
  });

  it("completes Google onboarding only with a server-signed verified identity", async () => {
      createdEmails.add("google-http@example.invalid");
    const fetcher = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "google-token-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: "google-http-user", email: "google-http@example.invalid", email_verified: true }), { status: 200 }));
    await withServer({
      db: prisma,
      tokenSecret: secret,
      now: () => now,
      google: { clientId: "client", clientSecret: "secret", redirectUri: "https://app.example.invalid/callback" },
      googleFetcher: fetcher,
    }, async baseUrl => {
      const exchange = await json(baseUrl, "/auth/google/exchange", { code: "one-use-code" });
      expect(exchange.status).toBe(200);
      const onboarding = (await exchange.json() as { data: { onboardingRequired: boolean; onboardingToken: string } }).data;
      expect(onboarding.onboardingRequired).toBe(true);
      const completed = await json(baseUrl, "/auth/google/complete-onboarding", {
        onboardingToken: onboarding.onboardingToken,
        role: Role.SUPPLIER,
        termsVersion: "terms-2026-01",
      });
      expect(completed.status).toBe(201);
      const data = (await completed.json() as { data: { user: { role: Role } } }).data;
      expect(data.user.role).toBe(Role.SUPPLIER);
      createdIds.add((await prisma.user.findUniqueOrThrow({ where: { email: "google-http@example.invalid" } })).id);
    });
  });

  it("updates own profile, confirms email changes, changes password, disconnects Google, and withdraws", async () => {
    let emailToken = "";
    const sendEmailChange = jest.fn(async (_email: string, token: string) => { emailToken = token; });
    await withServer({ db: prisma, tokenSecret: secret, now: () => now, sendEmailChange }, async baseUrl => {
      const account = await register(baseUrl);
      const patch = await fetch(`${baseUrl}/me`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Client" }),
      });
      expect(patch.status).toBe(200);
      expect((await patch.json() as { data: { name: string } }).data.name).toBe("Client");

      const changeRequest = await fetch(`${baseUrl}/me/email/change-request`, {
        method: "POST",
        headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ email: `next-${randomUUID()}@example.invalid` }),
      });
      expect(changeRequest.status).toBe(200);
      const confirmed = await json(baseUrl, "/me/email/change-confirm", { token: emailToken }, account.accessToken);
      expect(confirmed.status).toBe(200);

      const password = await fetch(`${baseUrl}/me/password/change`, {
        method: "POST",
        headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "Validpass123", newPassword: "Updatedpass123" }),
      });
      expect(password.status).toBe(200);
      const disconnected = await json(baseUrl, "/me/google/disconnect", { password: "Updatedpass123" }, account.accessToken);
      expect(disconnected.status).toBe(409);
      const withdrawn = await fetch(`${baseUrl}/me`, { method: "DELETE", headers: { authorization: `Bearer ${account.accessToken}` } });
      expect(withdrawn.status).toBe(200);
    });
  });
});
