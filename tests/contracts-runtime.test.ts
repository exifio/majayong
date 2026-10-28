import { Role } from "@prisma/client";
import { describe, expect, it, afterAll, beforeEach } from "@jest/globals";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { createApp } from "../src/app.ts";
import { createContractStorage } from "../src/contracts/contract-storage.ts";
import { createContractApiRouter } from "../src/contracts/contracts.router.ts";
import { prisma } from "../src/db.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";
import { TradeError } from "../src/trade/errors.ts";

async function createAcceptedApplication() {
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
      totalAmount: 240_001,
      durationDays: 14,
      firstViewedAt: new Date("2026-10-28T00:00:00Z"),
      items: { create: [{ specItemId, isAvailable: true, amount: 240_001 }] },
    },
  });
  return { application, project, supplier, specItemId };
}

function contractTestAuth(projectClientId: string, supplierId: string) {
  return async (request: Request) => {
    const userId = request.header("x-test-user");
    if (userId === projectClientId) return { userId, role: Role.CLIENT };
    if (userId === supplierId) return { userId, role: Role.SUPPLIER };
    if (userId === "other-client") return { userId, role: Role.CLIENT };
    return null;
  };
}

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
        specSnapshot: {
          specVersionNo: 1,
          projectTitle: "예약 캘린더 프로젝트",
          clientName: "의뢰인 이름",
          supplierName: "공급자",
          durationDays: 5,
          included: [{ specItemId, title: "기능", description: "기능 설명", amount: 100_000, installmentStage: "INTERIM" }],
          excluded: [],
        },
        agreedAmount: 100_000,
        clientFee: 5_000,
        supplierFee: 5_000,
        contentHash: hash,
        pdfUrl: `contracts/contract-route-integration/${"a".repeat(64)}.pdf`,
      },
    });

    const storageCalls: string[] = [];
    const uploads: Array<{ path: string; bytes: Uint8Array }> = [];
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
        uploadPrivateObject: async (input) => { storageCalls.push("upload"); uploads.push(input); },
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
      expect(uploads).toHaveLength(1);
      const finalPdf = uploads[0];
      if (!finalPdf) throw new Error("서명 완료 PDF가 필요합니다.");
      const finalHash = `sha256:${createHash("sha256").update(finalPdf.bytes).digest("hex")}`;
      const saved = await prisma.contract.findUniqueOrThrow({ where: { applicationId: application.id } });
      expect(saved).toMatchObject({ contentHash: hash, signedPdfHash: finalHash, signedPdfUrl: finalPdf.path });
      expect(saved.signedPdfHash).not.toBe(hash);
      expect(saved.clientSignedAt).not.toBeNull();
      expect(saved.supplierSignedAt).not.toBeNull();

      const pdfResponse = await fetch(
        `http://127.0.0.1:${getServerPort(server)}/api/contracts/${application.id}/pdf`,
        { headers: { "x-test-user": supplier.id }, redirect: "manual" },
      );
      expect(pdfResponse.status).toBe(302);
      expect(pdfResponse.headers.get("location")).toBe("https://storage.invalid/signed.pdf");
      expect(storageCalls).toEqual(["upload", "signed-url"]);
      expect(signedUrlRequests).toEqual([{
        bucket: "contracts",
        path: finalPdf.path,
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

  it("수락 지원서의 금액으로 계약을 만들고 의뢰인 본인만 생성할 수 있다", async () => {
    const { application, project, supplier, specItemId } = await createAcceptedApplication();
    const uploads: string[] = [];
    const router = createContractApiRouter({
      prismaClient: prisma,
      bucket: "contracts",
      storage: {
        uploadPrivateObject: async ({ path }) => { uploads.push(path); },
        createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
      },
    });
    const app = createApp({
      prismaClient: prisma,
      authVerifier: contractTestAuth(project.clientId, supplier.id),
      extraRouters: [router],
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));

    try {
      const url = `http://127.0.0.1:${getServerPort(server)}/api/contracts/${application.id}`;
      const body = JSON.stringify({
        interimRatio: 60,
        installmentStageBySpecItemId: { [specItemId]: "INTERIM" },
      });
      const supplierResponse = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": supplier.id },
        body,
      });
      const otherClientResponse = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": "other-client" },
        body,
      });
      expect(supplierResponse.status).toBe(403);
      expect(otherClientResponse.status).toBe(403);
      expect(await prisma.contract.count({ where: { applicationId: application.id } })).toBe(0);

      const clientAmountResponse = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": project.clientId },
        body: JSON.stringify({ agreedAmount: 1, interimRatio: 60, installmentStageBySpecItemId: { [specItemId]: "INTERIM" } }),
      });
      expect(clientAmountResponse.status).toBe(400);
      expect(await prisma.contract.count({ where: { applicationId: application.id } })).toBe(0);

      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": project.clientId },
        body,
      });
      expect(response.status).toBe(200);
      const payload = assertRecord(await response.json());
      expect(payload.status).toBe("PENDING_CONSENT");
      expect(typeof payload.contractId).toBe("string");
      const contract = await prisma.contract.findUniqueOrThrow({ where: { applicationId: application.id } });
      expect(contract.agreedAmount).toBe(application.totalAmount);
      expect(contract.agreedAmount).not.toBe(1);
      expect(contract.pdfUrl).toMatch(/^contracts\/.+\.pdf$/);
      expect(uploads).toHaveLength(1);

      const openApiResponse = await fetch(`http://127.0.0.1:${getServerPort(server)}/api-docs.json`);
      const openApi = assertRecord(await openApiResponse.json());
      const paths = assertRecord(openApi.paths);
      const createPath = assertRecord(paths["/api/contracts/{applicationId}"]);
      const createOperation = assertRecord(createPath.post);
      const requestBody = assertRecord(createOperation.requestBody);
      const content = assertRecord(requestBody.content);
      const jsonBody = assertRecord(content["application/json"]);
      const schema = assertRecord(jsonBody.schema);
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(assertRecord(schema.properties)).sort())
        .toEqual(["installmentStageBySpecItemId", "interimRatio"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("기존 계약의 PDF 업로드가 실패했으면 중복 요청으로 PDF를 재시도한다", async () => {
    const { application, project, specItemId } = await createAcceptedApplication();
    let uploadAttempts = 0;
    const router = createContractApiRouter({
      prismaClient: prisma,
      bucket: "contracts",
      storage: {
        uploadPrivateObject: async () => {
          uploadAttempts += 1;
          if (uploadAttempts === 1) throw new TradeError("CONTRACT_PDF_UPLOAD_FAILED");
        },
        createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
      },
    });
    const app = createApp({
      prismaClient: prisma,
      authVerifier: contractTestAuth(project.clientId, "unused-supplier"),
      extraRouters: [router],
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));

    try {
      const url = `http://127.0.0.1:${getServerPort(server)}/api/contracts/${application.id}`;
      const options = {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": project.clientId },
        body: JSON.stringify({ installmentStageBySpecItemId: { [specItemId]: "FINAL" } }),
      };
      const failedResponse = await fetch(url, options);
      expect(failedResponse.status).toBe(503);
      const pending = await prisma.contract.findUniqueOrThrow({ where: { applicationId: application.id } });
      expect(pending).toMatchObject({ status: "PENDING_CONSENT", contentHash: null, pdfUrl: null });

      const retryResponse = await fetch(url, options);
      expect(retryResponse.status).toBe(200);
      expect(await retryResponse.json()).toEqual({ contractId: pending.id, status: "PENDING_CONSENT" });
      expect(uploadAttempts).toBe(2);
      expect(await prisma.contract.findUniqueOrThrow({ where: { applicationId: application.id } }))
        .toMatchObject({ id: pending.id, status: "PENDING_CONSENT", pdfUrl: expect.stringMatching(/^contracts\/.+\.pdf$/) });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
