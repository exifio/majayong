import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { Server } from "node:http";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${getServerPort(server)}`,
  };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function createRateFixture() {
  const supplier = await prisma.user.create({
    data: {
      email: "supplier@test.local",
      name: "공급자",
      role: "SUPPLIER",
      supplierProfile: { create: { displayName: "공급자" } },
    },
  });
  const block = await prisma.blockCatalog.create({
    data: {
      code: "RATE_BOUNDARY_TEST",
      name: "테스트 블록",
      description: "단가 입력 경계 테스트",
      industryCode: "RESTAURANT_RESERVATION",
    },
  });
  return { supplierId: supplier.id, blockId: block.id };
}

describe("공급자 단가 API 입력·동시성·인증 경계", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.ALLOW_HEADER_AUTH = "true";
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("잘못된 JSON·자료형·금액을 거부하고 단가나 시작 이벤트를 저장하지 않는다", async () => {
    const { supplierId, blockId } = await createRateFixture();
    const { server, baseUrl } = await startServer();
    const invalidBodies = [
      "{",
      "[]",
      JSON.stringify({ price: 100_000 }),
      JSON.stringify({ blockId: "" , price: 100_000 }),
      JSON.stringify({ blockId, price: null }),
      JSON.stringify({ blockId, price: 0 }),
      JSON.stringify({ blockId, price: -1 }),
      JSON.stringify({ blockId, price: 1.5 }),
      JSON.stringify({ blockId, price: "100000" }),
      JSON.stringify({ blockId, isCapable: false, price: 100_000 }),
      JSON.stringify({ blockId, isCapable: "false" }),
    ];

    try {
      for (const body of invalidBodies) {
        const response = await fetch(`${baseUrl}/api/supplier/rates`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-id": supplierId,
            "x-user-role": "SUPPLIER",
          },
          body,
        });
        expect(response.status).toBe(400);
        const errorResponse = assertRecord(await response.json());
        expect(assertRecord(errorResponse.error).code).toBe("VALIDATION_ERROR");
      }

      expect(await prisma.supplierRate.count()).toBe(0);
      expect(await prisma.eventLog.count({ where: { type: "SUPPLIER_RATE_STARTED" } })).toBe(0);
    } finally {
      await stopServer(server);
    }
  });

  it("동시에 같은 공급자·블록 단가를 등록해도 한 건만 저장하고 한 요청은 409로 응답한다", async () => {
    const { supplierId, blockId } = await createRateFixture();
    const { server, baseUrl } = await startServer();

    try {
      const request = () =>
        fetch(`${baseUrl}/api/supplier/rates`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-id": supplierId,
            "x-user-role": "SUPPLIER",
          },
          body: JSON.stringify({ blockId, price: 125_000 }),
        });
      const responses = await Promise.all([request(), request()]);

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(await prisma.supplierRate.count({ where: { supplierId, blockId } })).toBe(1);
      expect(await prisma.eventLog.count({ where: { type: "SUPPLIER_RATE_STARTED" } })).toBe(1);
      expect(await prisma.eventLog.count({ where: { type: "SUPPLIER_RATE_COMPLETED" } })).toBe(1);

      const conflict = responses.find((response) => response.status === 409);
      if (!conflict) {
        throw new Error("동시 요청 중 하나는 409 응답이어야 합니다.");
      }
      const conflictBody = assertRecord(await conflict.json());
      expect(assertRecord(conflictBody.error).code).toBe("CONFLICT");
    } finally {
      await stopServer(server);
    }
  });

  it("마지막 수행 가능 단가를 비활성화하면 가격을 지우고 재활성화에는 새 가격을 요구한다", async () => {
    const { supplierId, blockId } = await createRateFixture();
    const { server, baseUrl } = await startServer();
    const headers = {
      "content-type": "application/json",
      "x-user-id": supplierId,
      "x-user-role": "SUPPLIER",
    };

    try {
      const created = await fetch(`${baseUrl}/api/supplier/rates`, {
        method: "POST",
        headers,
        body: JSON.stringify({ blockId, price: 200_000 }),
      });
      expect(created.status).toBe(201);

      const disabled = await fetch(`${baseUrl}/api/supplier/rates/${blockId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isCapable: false }),
      });
      expect(disabled.status).toBe(200);
      const disabledBody = assertRecord(await disabled.json());
      const disabledRate = assertRecord(disabledBody.rate);
      expect(disabledRate.isCapable).toBe(false);
      expect(disabledRate.price).toBe(null);
      expect(disabledBody.rateCompleted).toBe(false);

      const reenabledWithoutPrice = await fetch(`${baseUrl}/api/supplier/rates/${blockId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isCapable: true }),
      });
      expect(reenabledWithoutPrice.status).toBe(400);

      const saved = await prisma.supplierRate.findUniqueOrThrow({
        where: { supplierId_blockId: { supplierId, blockId } },
      });
      expect(saved.isCapable).toBe(false);
      expect(saved.price).toBe(null);
    } finally {
      await stopServer(server);
    }
  });

  it("운영 모드에서는 ALLOW_HEADER_AUTH=true여도 요청 헤더로 역할을 위조할 수 없다", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousHeaderAuth = process.env.ALLOW_HEADER_AUTH;
    process.env.NODE_ENV = "production";
    process.env.ALLOW_HEADER_AUTH = "true";

    let server: Server | undefined;
    try {
      const started = await startServer();
      server = started.server;
      const response = await fetch(`${started.baseUrl}/api/supplier/rates`, {
        headers: {
          "x-user-id": "forged-user",
          "x-user-role": "SUPPLIER",
        },
      });
      expect(response.status).toBe(401);
      const body = assertRecord(await response.json());
      expect(assertRecord(body.error).code).toBe("UNAUTHORIZED");
    } finally {
      if (server) {
        await stopServer(server);
      }
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousHeaderAuth === undefined) {
        delete process.env.ALLOW_HEADER_AUTH;
      } else {
        process.env.ALLOW_HEADER_AUTH = previousHeaderAuth;
      }
    }
  });
});
