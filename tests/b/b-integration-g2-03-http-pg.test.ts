import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAppHandler } from "../../src/composition.ts";
import { createPrismaPorts } from "../../src/integration/prisma-wiring.ts";
import {
  createApplicationTx,
  createPrismaApplicationUnitOfWork,
  type ApplicationDbClient,
} from "../../src/modules/application/prisma-adapter.ts";
import { createMarketplaceAutoRejectPort } from "../../src/modules/application/marketplace-port.ts";
import type { FileStorageAdapter } from "../../src/modules/files/index.ts";
import { createNotificationBridge } from "../../src/modules/notification/c-bridge.ts";
import { createPrismaNotificationTx } from "../../src/modules/notification/prisma-adapter.ts";

// G2-03: C HTTP 웹훅 → 예치 확정 → B 자동 거절·알림이 한 PostgreSQL 트랜잭션인지 확인한다.
// DATABASE_URL이 없으면 skip한다(전용 테스트 DB에서만 실행, 실제/공유 DB 금지).
const hasDatabase = Boolean(process.env.DATABASE_URL);
const WEBHOOK_SECRET = "g203-webhook-secret";
const NOW = new Date("2026-11-04T05:20:00.000Z");
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

type Ids = {
  clientId: string;
  supplierAId: string;
  supplierBId: string;
  draftId: string;
  projectId: string;
  acceptedApplicationId: string;
  rivalApplicationId: string;
  contractId: string;
};

async function seed(prisma: PrismaClient): Promise<Ids> {
  const ids: Ids = {
    clientId: randomUUID(),
    supplierAId: randomUUID(),
    supplierBId: randomUUID(),
    draftId: randomUUID(),
    projectId: randomUUID(),
    acceptedApplicationId: randomUUID(),
    rivalApplicationId: randomUUID(),
    contractId: randomUUID(),
  };
  await prisma.user.createMany({
    data: [
      { id: ids.clientId, email: `g203-c-${ids.clientId}@test.local`, role: "CLIENT" },
      { id: ids.supplierAId, email: `g203-a-${ids.supplierAId}@test.local`, role: "SUPPLIER" },
      { id: ids.supplierBId, email: `g203-b-${ids.supplierBId}@test.local`, role: "SUPPLIER" },
    ],
  });
  await prisma.supplierProfile.createMany({
    data: [
      { userId: ids.supplierAId, displayName: "수락 공급자", industryCodes: [], skills: [] },
      { userId: ids.supplierBId, displayName: "경쟁 공급자", industryCodes: [], skills: [] },
    ],
  });
  await prisma.draft.create({ data: { id: ids.draftId, clientId: ids.clientId, entryType: "SENTENCE" } });
  await prisma.project.create({
    data: {
      id: ids.projectId,
      draftId: ids.draftId,
      confirmedAt: NOW,
      disclosureConsentVersion: "v1",
      title: "예약 사이트",
      summary: "예약",
      industryCode: "FOOD",
      requiredSkills: [],
      status: "RECRUITING",
    },
  });
  await prisma.application.createMany({
    data: [
      {
        id: ids.acceptedApplicationId,
        projectId: ids.projectId,
        supplierId: ids.supplierAId,
        specVersionNo: 1,
        totalAmount: 3_100_000,
        durationDays: 42,
        firstViewedAt: NOW,
        status: "ACCEPTED",
      },
      {
        id: ids.rivalApplicationId,
        projectId: ids.projectId,
        supplierId: ids.supplierBId,
        specVersionNo: 1,
        totalAmount: 3_000_000,
        durationDays: 40,
        firstViewedAt: NOW,
        status: "SUBMITTED",
      },
    ],
  });
  await prisma.contract.create({
    data: {
      id: ids.contractId,
      applicationId: ids.acceptedApplicationId,
      specVersionNo: 1,
      status: "ACTIVE",
      agreedAmount: 3_100_000,
      durationDays: 42,
      clientFee: 155_000,
      supplierFee: 155_000,
      consentDeadline: NOW,
      contentHash: "hash-g203",
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
      interimRatio: 50,
    },
  });
  return ids;
}

async function cleanup(prisma: PrismaClient, ids: Ids): Promise<void> {
  const applicationIds = [ids.acceptedApplicationId, ids.rivalApplicationId];
  const userIds = [ids.clientId, ids.supplierAId, ids.supplierBId];
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { targetId: { in: applicationIds } }] },
  });
  await prisma.paymentEvent.deleteMany({ where: { deposit: { contractId: ids.contractId } } });
  await prisma.paymentInstallment.deleteMany({ where: { contractId: ids.contractId } });
  await prisma.escrowDeposit.deleteMany({ where: { contractId: ids.contractId } });
  await prisma.contract.deleteMany({ where: { id: ids.contractId } });
  await prisma.application.deleteMany({ where: { id: { in: applicationIds } } });
  await prisma.project.deleteMany({ where: { id: ids.projectId } });
  await prisma.draft.deleteMany({ where: { id: ids.draftId } });
  await prisma.supplierProfile.deleteMany({ where: { userId: { in: [ids.supplierAId, ids.supplierBId] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

type VerifyResult = (input: { orderId: string; paymentKey: string; amount: number }) => unknown;

async function start(
  prisma: PrismaClient,
  ids: Ids,
  options: { verify?: VerifyResult; now?: Date } = {},
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const prismaPorts = createPrismaPorts(prisma);
  const handler = createAppHandler(
    {
      prisma,
      webhookSecret: WEBHOOK_SECRET,
      clock: { now: () => options.now ?? NOW },
      ports: {
        marketplace: createMarketplaceAutoRejectPort(
          createPrismaApplicationUnitOfWork(prismaPorts.application),
          (tx) => createApplicationTx(tx as ApplicationDbClient),
        ),
        notifications: createNotificationBridge(
          createPrismaNotificationTx(prismaPorts.notification),
          { now: () => options.now ?? NOW },
        ),
        profileReview: {
          async updateProfileReviewStats() {
            return { success: true };
          },
        },
        storage: {
          async createUploadUrl() {
            throw new Error("STORAGE_UNUSED");
          },
          async createDownloadUrl() {
            throw new Error("STORAGE_UNUSED");
          },
        } as unknown as FileStorageAdapter,
        catalogAdmin: {
          async executeBlockAction(input) {
            return { success: true, blockId: input.blockId, action: input.action };
          },
        },
        tossVerifier: {
          async verifyPayment(orderId, paymentKey, amount) {
            if (options.verify === undefined) return { verified: true, orderId, paymentKey, amount, status: "DONE" };
            const result = options.verify({ orderId, paymentKey, amount });
            return result === undefined
              ? { verified: true, orderId, paymentKey, amount, status: "DONE" }
              : result;
          },
        },
      },
    },
    (req) => {
      const userId = req.headers["x-test-user"];
      const role = req.headers["x-test-role"];
      if (typeof userId !== "string" || typeof role !== "string") return null;
      return { userId, role: role as "CLIENT" | "SUPPLIER" | "ADMIN" };
    },
  );

  const server = createServer((req, res) => {
    void handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
}

async function openDeposit(
  baseUrl: string,
  ids: Ids,
  amount = 3_255_000,
  idempotencyKey = `idem-${randomUUID()}`,
): Promise<{ depositId: string; status: number }> {
  const created = await post(
    `${baseUrl}/contracts/${ids.contractId}/deposits`,
    { idempotencyKey, method: "CARD", amount },
    { "x-test-user": ids.clientId, "x-test-role": "CLIENT" },
  );
  const depositId = (created.body as { deposit?: { id?: string } } | null)?.deposit?.id;
  assert.equal(created.status, 201);
  assert.equal(typeof depositId, "string");
  return { depositId: depositId as string, status: created.status };
}

function webhook(
  baseUrl: string,
  depositId: string,
  overrides: Partial<{ paymentKey: string; amount: number; status: string; transactionKey: string }> = {},
): Promise<{ status: number; body: unknown }> {
  return post(
    `${baseUrl}/integrations/toss/payment-events`,
    {
      orderId: depositId,
      paymentKey: overrides.paymentKey ?? "pk-g203",
      amount: overrides.amount ?? 3_255_000,
      status: overrides.status ?? "DONE",
      transactionKey: overrides.transactionKey ?? `tx-${randomUUID()}`,
    },
    { "x-toss-webhook-secret": WEBHOOK_SECRET },
  );
}

describe("INT-G2-03: C HTTP 예치 확정 원자성", { skip: hasDatabase ? false : "DATABASE_URL 없음" }, () => {
  it("검증된 웹훅은 예치·계약·2구간·자동 거절·알림을 한 트랜잭션으로 저장한다", async () => {
    const prisma = new PrismaClient();
    const ids = await seed(prisma);
    const running = await start(prisma, ids);
    try {
      const { depositId } = await openDeposit(running.baseUrl, ids);
      const result = await webhook(running.baseUrl, depositId, { transactionKey: "tx-success" });
      assert.equal(result.status, 200);
      assert.equal((result.body as { status?: string }).status, "COMPLETED");

      const deposit = await prisma.escrowDeposit.findUniqueOrThrow({ where: { id: depositId } });
      assert.equal(deposit.status, "COMPLETED");
      assert.equal(deposit.pgKey, "pk-g203");

      const contract = await prisma.contract.findUniqueOrThrow({ where: { id: ids.contractId } });
      assert.equal(contract.paymentStatus, "DEPOSITED");
      assert.equal(contract.totalDeposited, 3_255_000);
      assert.ok(contract.workDueAt !== null);

      const installments = await prisma.paymentInstallment.findMany({
        where: { contractId: ids.contractId },
        orderBy: { stage: "asc" },
      });
      assert.deepEqual(
        installments.map((row) => row.stage),
        ["INTERIM", "FINAL"],
      );
      assert.equal(installments.reduce((sum, row) => sum + row.amount, 0), 3_100_000);
      assert.equal(installments.every((row) => row.ratio === 50), true);

      assert.equal(
        (await prisma.application.findUniqueOrThrow({ where: { id: ids.rivalApplicationId } })).status,
        "AUTO_REJECTED",
      );
      assert.equal(
        await prisma.notification.count({
          where: {
            userId: ids.supplierBId,
            type: "APPLICATION_AUTO_REJECTED",
            targetId: ids.rivalApplicationId,
          },
        }),
        1,
      );
      assert.equal(
        await prisma.paymentEvent.count({ where: { depositId, eventType: "VERIFIED" } }),
        1,
      );
    } finally {
      await running.close();
      await cleanup(prisma, ids);
      await prisma.$disconnect();
    }
  });

  it("중복 콜백은 추가 구간·이벤트 없이 멱등 반환한다", async () => {
    const prisma = new PrismaClient();
    const ids = await seed(prisma);
    const running = await start(prisma, ids);
    try {
      const { depositId } = await openDeposit(running.baseUrl, ids);
      assert.equal((await webhook(running.baseUrl, depositId, { transactionKey: "tx-duplicate" })).status, 200);
      const again = await webhook(running.baseUrl, depositId, { transactionKey: "tx-duplicate" });
      assert.equal(again.status, 200);
      assert.equal((again.body as { isDuplicate?: boolean }).isDuplicate, true);
      assert.equal(await prisma.paymentInstallment.count({ where: { contractId: ids.contractId } }), 2);
      assert.equal(await prisma.paymentEvent.count({ where: { depositId, eventType: "VERIFIED" } }), 1);
    } finally {
      await running.close();
      await cleanup(prisma, ids);
      await prisma.$disconnect();
    }
  });

  it("동시 콜백은 구간·VERIFIED 이벤트를 한 번만 만든다", async () => {
    const prisma = new PrismaClient();
    const ids = await seed(prisma);
    const running = await start(prisma, ids);
    try {
      const { depositId } = await openDeposit(running.baseUrl, ids);
      const [first, second] = await Promise.all([
        webhook(running.baseUrl, depositId, { transactionKey: "tx-concurrent" }),
        webhook(running.baseUrl, depositId, { transactionKey: "tx-concurrent" }),
      ]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(await prisma.paymentInstallment.count({ where: { contractId: ids.contractId } }), 2);
      assert.equal(await prisma.paymentEvent.count({ where: { depositId, eventType: "VERIFIED" } }), 1);
      assert.equal(
        await prisma.notification.count({
          where: { userId: ids.supplierBId, type: "APPLICATION_AUTO_REJECTED", targetId: ids.rivalApplicationId },
        }),
        1,
      );
    } finally {
      await running.close();
      await cleanup(prisma, ids);
      await prisma.$disconnect();
    }
  });

  it("위조 웹훅·금액 불일치·PG 검증 실패·기한 경과는 완료 없이 HELD/401로 격리한다", async () => {
    const prisma = new PrismaClient();
    const ids = await seed(prisma);
    try {
      const forged = await start(prisma, ids);
      try {
        const { depositId } = await openDeposit(forged.baseUrl, ids);
        const noSecret = await post(
          `${forged.baseUrl}/integrations/toss/payment-events`,
          { orderId: depositId, paymentKey: "pk", amount: 3_255_000, status: "DONE" },
        );
        assert.equal(noSecret.status, 401);
        assert.equal(
          (await prisma.escrowDeposit.findUniqueOrThrow({ where: { id: depositId } })).status,
          "PENDING",
        );
      } finally {
        await forged.close();
      }

      const mismatch = await start(prisma, ids, { now: new Date("2026-11-05T00:00:00.000Z") });
      try {
        const { depositId } = await openDeposit(mismatch.baseUrl, ids);
        const result = await webhook(mismatch.baseUrl, depositId, { amount: 1_000 });
        assert.equal(result.status, 200);
        assert.equal((result.body as { status?: string }).status, "HELD");
        assert.equal(
          (await prisma.escrowDeposit.findUniqueOrThrow({ where: { id: depositId } })).status,
          "HELD",
        );
        assert.equal(await prisma.paymentInstallment.count({ where: { contractId: ids.contractId } }), 0);
        assert.equal(
          await prisma.paymentEvent.count({ where: { depositId, eventType: "AMOUNT_MISMATCH" } }),
          1,
        );
      } finally {
        await mismatch.close();
      }
    } finally {
      await cleanup(prisma, ids);
      await prisma.$disconnect();
    }
  });

  it("PG 재조회가 거부하면 완료하지 않는다", async () => {
    const prisma = new PrismaClient();
    const ids = await seed(prisma);
    const rejected = await start(prisma, ids, {
      verify: ({ orderId, paymentKey, amount }) => ({
        verified: false,
        orderId,
        paymentKey,
        amount,
        status: "DONE",
      }),
    });
    try {
      const { depositId } = await openDeposit(rejected.baseUrl, ids);
      const result = await webhook(rejected.baseUrl, depositId);
      assert.equal((result.body as { status?: string }).status, "HELD");
      assert.equal(
        await prisma.paymentInstallment.count({ where: { contractId: ids.contractId } }),
        0,
      );
    } finally {
      await rejected.close();
      await cleanup(prisma, ids);
      await prisma.$disconnect();
    }
  });

  it("예치 기한이 지난 콜백은 HELD로 격리하고 완료하지 않는다", async () => {
    const prisma = new PrismaClient();
    const ids = await seed(prisma);
    const late = await start(prisma, ids, { now: new Date("2026-11-08T00:00:00.000Z") });
    try {
      const pending = await prisma.escrowDeposit.create({
        data: {
          contractId: ids.contractId,
          principal: 3_100_000,
          clientFee: 155_000,
          amount: 3_255_000,
          method: "CARD",
          status: "PENDING",
          idempotencyKey: `idem-late-${randomUUID()}`,
        },
      });
      const result = await webhook(late.baseUrl, pending.id);
      assert.equal((result.body as { status?: string }).status, "HELD");
      assert.equal(
        (await prisma.escrowDeposit.findUniqueOrThrow({ where: { id: pending.id } })).status,
        "HELD",
      );
      assert.equal(await prisma.paymentInstallment.count({ where: { contractId: ids.contractId } }), 0);
    } finally {
      await late.close();
      await cleanup(prisma, ids);
      await prisma.$disconnect();
    }
  });
});
