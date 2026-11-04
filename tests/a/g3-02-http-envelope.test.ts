import { afterAll, describe, expect, it } from "@jest/globals";
import { createServer, type Server } from "node:http";
import { Router } from "express";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../../src/app.ts";
import { createHttpHandler, type AppServices } from "../../src/c-app.ts";

// G3-02: C 핸들러가 매칭하지 못한 경로도 A/B와 같은 공통 404 봉투를 써야 한다.
const tokenSecret = "integration-envelope-token-secret-32-bytes";
const servers: Server[] = [];

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function startIntegrated(): Promise<string> {
  const fallback = createHttpHandler({
    services: {} as unknown as AppServices,
    authenticate: () => null,
    deferUnmatched: true,
  });
  return listen(createServer(createApp({
    db: {} as unknown as PrismaClient,
    tokenSecret,
    fallback,
  })));
}

describe("G3-02: 공통 오류 봉투", () => {
  it("C가 매칭하지 못한 경로도 공통 404 봉투와 x-request-id를 쓴다", async () => {
    const baseUrl = await startIntegrated();
    const res = await fetch(`${baseUrl}/api/v1/__not_a_c_route__`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; requestId?: string };
      message?: string;
    };
    expect(body.error?.code).toBe("NOT_FOUND");
    expect(typeof body.error?.requestId).toBe("string");
    expect(res.headers.get("x-request-id")).toBe(body.error?.requestId);
  });

  it("Toss 웹훅 경로는 Bearer 없이 C fallback까지 도달한다", async () => {
    let reached = false;
    const fallback = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
      reached = true;
      res.statusCode = 418;
      res.end("fallback");
    };
    const baseUrl = await listen(createServer(createApp({
      db: {} as unknown as PrismaClient,
      tokenSecret,
      routers: [Router()],
      fallback,
    })));

    const res = await fetch(`${baseUrl}/api/v1/integrations/toss/payment-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(418);
    expect(reached).toBe(true);
  });

  it("단독 C 핸들러는 기존 404 형식을 유지한다", async () => {
    const handler = createHttpHandler({
      services: {} as unknown as AppServices,
      authenticate: () => null,
    });
    const baseUrl = await listen(createServer((req, res) => { void handler(req, res); }));
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "NOT_FOUND" });
  });
});
