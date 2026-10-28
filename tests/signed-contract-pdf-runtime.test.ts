import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { prisma } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { createContractApiRouter } from "../src/contracts/contracts.router.ts";
import { createSignedContractPdfService } from "../src/contracts/signed-contract-pdf-service.ts";
import type { ContractStorage } from "../src/trade/contract-workflow.ts";
import { getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

async function signedFixture() {
  const project = await createProjectFixture({ status: "CONTRACTED" });
  const supplier = await createSupplierFixture();
  const specItemId = project.itemIds[0];
  if (!specItemId) throw new Error("계약 항목이 필요합니다.");
  const application = await prisma.application.create({
    data: {
      projectId: project.projectId, supplierId: supplier.id, status: "ACCEPTED",
      revisionNo: 1, specVersionNo: 1, totalAmount: 200_000, durationDays: 14, firstViewedAt: new Date(),
      items: { create: [{ specItemId, isAvailable: true, amount: 200_000 }] },
    },
  });
  const id = `contract-${application.id}`;
  const contentHash = `sha256:${"a".repeat(64)}`;
  const contract = await prisma.contract.create({
    data: {
      id, applicationId: application.id, status: "ACTIVE", specVersionNo: 1,
      specSnapshot: {
        specVersionNo: 1, durationDays: 14, projectTitle: "프로젝트", clientName: "의뢰인", supplierName: "공급자",
        included: [{ title: "기능", description: "범위", amount: 200_000, installmentStage: "INTERIM" }], excluded: [],
      },
      agreedAmount: 200_000, clientFee: 10_000, supplierFee: 10_000,
      contentHash, pdfUrl: `contracts/${id}/${contentHash.slice(7)}.pdf`,
      clientSignedAt: new Date("2026-10-28T01:00:00Z"), supplierSignedAt: new Date("2026-10-28T02:00:00Z"),
    },
  });
  return { project, supplier, application, contract };
}

describe("서명 완료 PDF 저장과 다운로드", () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => { await resetDatabase(); await prisma.$disconnect(); });

  it("저장 실패는 원본과 서명 기록을 유지하며 다음 다운로드가 완료본 생성을 재시도한다", async () => {
    const { project, application, contract } = await signedFixture();
    let uploads = 0;
    const files: Uint8Array[] = [];
    const paths: string[] = [];
    const storage: ContractStorage = {
      uploadPrivateObject: async ({ bytes }) => {
        if (++uploads === 1) throw new Error("fake upload failure");
        files.push(bytes);
      },
      createSignedUrl: async ({ path }) => { paths.push(path); return "https://storage.invalid/signed"; },
    };
    const service = createSignedContractPdfService(prisma, { storage, bucket: "contracts" });
    await expect(service.prepare(application.id)).rejects.toThrow("fake upload failure");
    expect(await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).toMatchObject({
      status: "ACTIVE", contentHash: contract.contentHash, pdfUrl: contract.pdfUrl, signedPdfHash: null, signedPdfUrl: null,
    });

    await expect(service.getDownloadUrl({ userId: "outsider", role: "CLIENT" }, application.id, "contracts"))
      .rejects.toMatchObject({ code: "CONTRACT_SIGNING_FORBIDDEN" });
    expect(uploads).toBe(1);
    await expect(service.getDownloadUrl({ userId: project.clientId, role: "CLIENT" }, application.id, "contracts"))
      .resolves.toBe("https://storage.invalid/signed");
    const saved = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    const file = files[0];
    if (!file) throw new Error("서명 완료 PDF가 없습니다.");
    expect(saved.signedPdfHash).toBe(`sha256:${createHash("sha256").update(file).digest("hex")}`);
    expect(saved.signedPdfUrl).toBe(paths[0]);
    expect(saved.contentHash).toBe(contract.contentHash);
    expect(saved.pdfUrl).toBe(contract.pdfUrl);
    expect(saved.clientSignedAt).toEqual(contract.clientSignedAt);
    expect(saved.supplierSignedAt).toEqual(contract.supplierSignedAt);
  });

  it("동시 완료본 생성은 하나의 DB 경로로 수렴하고 취소 후 양측이 다운로드할 수 있다", async () => {
    const { project, supplier, application, contract } = await signedFixture();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let uploads = 0;
    const storage: ContractStorage = {
      uploadPrivateObject: async () => { if (++uploads === 2) release(); await gate; },
      createSignedUrl: async ({ path }) => path,
    };
    const service = createSignedContractPdfService(prisma, { storage, bucket: "contracts" });
    const [first, second] = await Promise.all([service.prepare(application.id), service.prepare(application.id)]);
    expect(first).toEqual(second);
    expect(uploads).toBe(2);
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "CANCELLED" } });
    await prisma.application.update({ where: { id: application.id }, data: { status: "REJECTED" } });
    await expect(service.getDownloadUrl({ userId: project.clientId, role: "CLIENT" }, application.id, "contracts"))
      .resolves.toBe(first.pdfUrl);
    await expect(service.getDownloadUrl({ userId: supplier.id, role: "SUPPLIER" }, application.id, "contracts"))
      .resolves.toBe(first.pdfUrl);
    expect(uploads).toBe(2);
  });

  it("한쪽만 서명한 계약은 PDF를 만들지 않는다", async () => {
    const { application, contract } = await signedFixture();
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "PENDING_CONSENT", supplierSignedAt: null } });
    const storage: ContractStorage = {
      uploadPrivateObject: async () => { throw new Error("업로드하지 않아야 합니다."); },
      createSignedUrl: async () => { throw new Error("URL을 만들지 않아야 합니다."); },
    };
    await expect(createSignedContractPdfService(prisma, { storage, bucket: "contracts" }).prepare(application.id))
      .rejects.toMatchObject({ code: "CONTRACT_NOT_SIGNED" });
  });

  it("두 번째 서명 뒤 업로드 실패는 서명 성공으로 응답하고 다운로드에서 복구한다", async () => {
    const { supplier, application, contract } = await signedFixture();
    await prisma.project.update({ where: { id: application.projectId }, data: { status: "ACCEPTED" } });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "PENDING_CONSENT", supplierSignedAt: null } });
    let uploads = 0;
    const storage: ContractStorage = {
      uploadPrivateObject: async () => { if (++uploads === 1) throw new Error("fake upload failure"); },
      createSignedUrl: async () => "https://storage.invalid/signed",
    };
    const app = createApp({
      prismaClient: prisma,
      authVerifier: () => ({ userId: supplier.id, role: "SUPPLIER" }),
      extraRouters: [createContractApiRouter({ prismaClient: prisma, storage, bucket: "contracts" })],
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const base = `http://127.0.0.1:${getServerPort(server)}/api/contracts/${application.id}`;
      const response = await fetch(`${base}/signature`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentHash: contract.contentHash }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ACTIVE" });
      expect(await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).toMatchObject({
        status: "ACTIVE", contentHash: contract.contentHash, signedPdfHash: null, signedPdfUrl: null,
      });
      const download = await fetch(`${base}/pdf`, { redirect: "manual" });
      expect(download.status).toBe(302);
      expect(download.headers.get("location")).toBe("https://storage.invalid/signed");
      expect(uploads).toBe(2);
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).signedPdfHash).not.toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
