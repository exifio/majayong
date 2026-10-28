import { Role } from "@prisma/client";
import { describe, expect, it, afterAll, beforeEach } from "@jest/globals";
import type { Request } from "express";
import { createApp } from "../src/app.ts";
import { createContractStorage } from "../src/contracts/contract-storage.ts";
import { createContractApiRouter } from "../src/contracts/contracts.router.ts";
import { prisma } from "../src/db.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

describe("production 계약 라우터 조립", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("/api/contracts에 B 서명 라우트를 mount하고 인증·당사자 검증 및 두 번째 서명을 A 전이와 묶는다", async () => {
    const project = await createProjectFixture({ status: "ACCEPTED" });
    const supplier = await createSupplierFixture();
    const specItemId = project.itemIds[0];
    if (!specItemId) throw new Error("계약 범위 항목이 필요합니다.");
    const application = await prisma.application.create({
      data: {
        projectId: project.projectId,
        supplierId: supplier.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "ACCEPTED",
        totalAmount: 100_000,
        durationDays: 5,
        firstViewedAt: new Date(),
        items: { create: [{ specItemId, isAvailable: true, amount: 100_000 }] },
      },
    });
    const hash = `sha256:${"a".repeat(64)}`;
    await prisma.contract.create({
      data: {
        id: "contract-route-integration",
        applicationId: application.id,
        status: "PENDING_CONSENT",
        specVersionNo: 1,
        specSnapshot: { included: [{ specItemId }], excluded: [] },
        agreedAmount: 100_000,
        clientFee: 5_000,
        supplierFee: 5_000,
        contentHash: hash,
        pdfUrl: `contracts/contract-route-integration/${"a".repeat(64)}.pdf`,
      },
    });

    const storageCalls: string[] = [];
    const signedUrlRequests: Array<{
      bucket: string;
      path: string;
      expiresInSeconds: number;
      download: true;
    }> = [];
    const contractRouter = createContractApiRouter({
      prismaClient: prisma,
      bucket: "contracts",
      storage: {
        uploadPrivateObject: async () => { storageCalls.push("upload"); },
        createSignedUrl: async (input) => {
          storageCalls.push("signed-url");
          signedUrlRequests.push(input);
          return "https://storage.invalid/signed.pdf";
        },
      },
    });
    let verifiedSignatures = 0;
    let releaseSignatures: (() => void) | undefined;
    const bothSignaturesVerified = new Promise<void>((resolve) => {
      releaseSignatures = resolve;
    });
    const app = createApp({
      prismaClient: prisma,
      authVerifier: async (request: Request) => {
        const userId = request.header("x-test-user");
        if (userId === project.clientId || userId === supplier.id) {
          verifiedSignatures += 1;
          if (verifiedSignatures === 2) releaseSignatures?.();
          await bothSignaturesVerified;
          return userId === project.clientId
            ? { userId, role: Role.CLIENT, sessionId: "client-session" }
            : { userId, role: Role.SUPPLIER, sessionId: "supplier-session" };
        }
        if (userId === "outsider") return { userId, role: Role.SUPPLIER };
        return null;
      },
      extraRouters: [contractRouter],
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));

    try {
      const url = `http://127.0.0.1:${getServerPort(server)}/api/contracts/${application.id}/signature`;
      const outsiderResponse = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": "outsider" },
        body: JSON.stringify({ contentHash: hash }),
      });
      expect(outsiderResponse.status).toBe(403);
      expect(assertRecord(assertRecord(await outsiderResponse.json()).error).code).toBe("FORBIDDEN");

      const [clientResponse, supplierResponse] = await Promise.all([
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-test-user": project.clientId },
          body: JSON.stringify({ contentHash: hash }),
        }),
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-test-user": supplier.id },
          body: JSON.stringify({ contentHash: hash }),
        }),
      ]);
      expect([clientResponse.status, supplierResponse.status]).toEqual([200, 200]);
      const signatureBodies = await Promise.all([clientResponse.json(), supplierResponse.json()]);
      const signatureStatuses = signatureBodies.map((body) => assertRecord(body).status).sort();
      expect(signatureStatuses).toEqual(["ACTIVE", "PENDING_CONSENT"]);
      expect(verifiedSignatures).toBe(2);

      const pdfResponse = await fetch(
        `http://127.0.0.1:${getServerPort(server)}/api/contracts/${application.id}/pdf`,
        { headers: { "x-test-user": supplier.id }, redirect: "manual" },
      );
      expect(pdfResponse.status).toBe(302);
      expect(pdfResponse.headers.get("location")).toBe("https://storage.invalid/signed.pdf");
      expect(storageCalls).toEqual(["signed-url"]);
      expect(signedUrlRequests).toEqual([{
        bucket: "contracts",
        path: `contracts/contract-route-integration/${"a".repeat(64)}.pdf`,
        expiresInSeconds: 300,
        download: true,
      }]);
      expect(await prisma.project.findUnique({ where: { id: project.projectId }, select: { status: true } }))
        .toMatchObject({ status: "CONTRACTED" });
      expect(await prisma.eventLog.count({ where: { projectId: project.projectId, type: "CONTRACT_AGREED" } })).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("Supabase 비밀 설정이 없으면 Storage를 호출하지 않고 오류를 정규화한다", async () => {
    const storage = createContractStorage({});

    await expect(storage.uploadPrivateObject({
      bucket: "contracts",
      path: "contracts/c1/hash.pdf",
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      contentType: "application/pdf",
      upsert: true,
    })).rejects.toHaveProperty("code", "CONTRACT_PDF_UPLOAD_FAILED");
    await expect(storage.createSignedUrl({
      bucket: "contracts",
      path: "contracts/c1/hash.pdf",
      expiresInSeconds: 300,
      download: true,
    })).rejects.toHaveProperty("code", "CONTRACT_PDF_URL_FAILED");
  });
});
