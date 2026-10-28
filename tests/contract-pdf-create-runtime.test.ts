import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { prisma } from "../src/db.ts";
import {
  createContractForAcceptedApplication,
  createContractWorkflowPorts,
  prepareContractPdfForAcceptedApplication,
} from "../src/shared/contract-workflow-adapter.ts";
import { createContractWorkflow, type ContractStorage } from "../src/trade/contract-workflow.ts";
import { resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

async function acceptedApplication() {
  const project = await createProjectFixture({ status: "ACCEPTED" });
  const supplier = await createSupplierFixture();
  const specItemId = project.itemIds[0];
  if (!specItemId) throw new Error("계약 항목이 필요합니다.");
  const application = await prisma.application.create({
    data: {
      projectId: project.projectId,
      supplierId: supplier.id,
      status: "ACCEPTED",
      revisionNo: 1,
      specVersionNo: 1,
      totalAmount: 200_000,
      durationDays: 14,
      firstViewedAt: new Date("2026-10-28T00:00:00Z"),
      items: { create: [{ specItemId, isAvailable: true, amount: 200_000 }] },
    },
  });
  return { application, specItemId, project, supplier };
}

describe("계약 생성 시 PDF 준비", () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => { await resetDatabase(); await prisma.$disconnect(); });

  it("계약 내용으로 PDF를 만들어 비공개 저장하고 실제 바이트의 해시와 경로를 기록한다", async () => {
    const { application, specItemId, project, supplier } = await acceptedApplication();
    const uploads: { bucket: string; path: string; bytes: Uint8Array }[] = [];
    const storage: ContractStorage = {
      uploadPrivateObject: async (input) => { uploads.push(input); },
      createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
    };
    const contract = await createContractForAcceptedApplication(prisma, { storage, bucket: "contracts" })({
      applicationId: application.id,
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { [specItemId]: "INTERIM" },
    });

    expect(uploads).toHaveLength(1);
    const upload = uploads[0];
    if (!upload) throw new Error("PDF 업로드가 필요합니다.");
    const digest = createHash("sha256").update(upload.bytes).digest("hex");
    expect(Buffer.from(upload.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(upload).toMatchObject({ bucket: "contracts", path: `contracts/${contract.id}/${digest}.pdf` });
    expect(contract).toMatchObject({ contentHash: `sha256:${digest}`, pdfUrl: upload.path, status: "PENDING_CONSENT" });
    expect(contract.specSnapshot).toMatchObject({
      durationDays: 14,
      projectTitle: "예약 캘린더 프로젝트",
      clientName: "의뢰인 이름",
      supplierName: "공급자",
      included: [{ specItemId, installmentStage: "INTERIM" }],
    });
    if (contract.contentHash === null) throw new Error("서명할 PDF의 해시가 필요합니다.");
    const workflow = createContractWorkflow(createContractWorkflowPorts(prisma), storage);
    const first = await workflow.sign({
      applicationId: application.id,
      actor: { userId: project.clientId, role: "CLIENT" },
      contentHash: contract.contentHash,
    });
    const second = await workflow.sign({
      applicationId: application.id,
      actor: { userId: supplier.id, role: "SUPPLIER" },
      contentHash: contract.contentHash,
    });
    expect(first.status).toBe("PENDING_CONSENT");
    expect(second).toMatchObject({ status: "ACTIVE", contentHash: contract.contentHash });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: project.projectId }, select: { status: true } })).toEqual({ status: "CONTRACTED" });
  });

  it("저장 실패 후 같은 계약에서 PDF 준비를 재시도한다", async () => {
    const { application, specItemId } = await acceptedApplication();
    let attempts = 0;
    const storage: ContractStorage = {
      uploadPrivateObject: async () => { if (++attempts === 1) throw new Error("fake storage failure"); },
      createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
    };
    const options = { storage, bucket: "contracts" };
    await expect(createContractForAcceptedApplication(prisma, options)({
      applicationId: application.id,
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { [specItemId]: "INTERIM" },
    })).rejects.toThrow("fake storage failure");
    const pending = await prisma.contract.findUniqueOrThrow({ where: { applicationId: application.id } });
    expect(pending).toMatchObject({ contentHash: null, pdfUrl: null, status: "PENDING_CONSENT" });

    const artifact = await prepareContractPdfForAcceptedApplication(prisma, options)(application.id);
    expect(await prisma.contract.count({ where: { applicationId: application.id } })).toBe(1);
    expect(await prisma.contract.findUniqueOrThrow({ where: { applicationId: application.id } })).toMatchObject(artifact);
    expect(attempts).toBe(2);
  });

  it("저장 bucket 설정이 없으면 계약을 생성하지 않는다", async () => {
    const { application } = await acceptedApplication();
    const storage: ContractStorage = {
      uploadPrivateObject: async () => { throw new Error("호출하지 않아야 합니다."); },
      createSignedUrl: async () => { throw new Error("호출하지 않아야 합니다."); },
    };
    expect(() => createContractForAcceptedApplication(prisma, { storage, bucket: " " }))
      .toThrow("CONTRACT_PDF_UPLOAD_FAILED");
    expect(await prisma.contract.count({ where: { applicationId: application.id } })).toBe(0);
  });

  it("동시 PDF 재시도는 하나의 저장된 경로와 해시를 반환한다", async () => {
    const { application, specItemId } = await acceptedApplication();
    const unavailable: ContractStorage = {
      uploadPrivateObject: async () => { throw new Error("fake storage failure"); },
      createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
    };
    await expect(createContractForAcceptedApplication(prisma, { storage: unavailable, bucket: "contracts" })({
      applicationId: application.id,
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { [specItemId]: "INTERIM" },
    })).rejects.toThrow("fake storage failure");

    let release = () => {};
    const ready = new Promise<void>((resolve) => { release = resolve; });
    let uploads = 0;
    const storage: ContractStorage = {
      uploadPrivateObject: async () => { if (++uploads === 2) release(); await ready; },
      createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
    };
    const prepare = prepareContractPdfForAcceptedApplication(prisma, { storage, bucket: "contracts" });
    const results = await Promise.all([prepare(application.id), prepare(application.id)]);
    expect(uploads).toBe(2);
    expect(results[0]).toEqual(results[1]);
    expect(await prisma.contract.findUniqueOrThrow({ where: { applicationId: application.id } })).toMatchObject(results[0]);
  });

  it("이미 서명된 계약의 누락된 PDF는 다시 만들지 않는다", async () => {
    const { application, specItemId } = await acceptedApplication();
    let uploads = 0;
    const storage: ContractStorage = {
      uploadPrivateObject: async () => { uploads++; throw new Error("fake storage failure"); },
      createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
    };
    const options = { storage, bucket: "contracts" };
    await expect(createContractForAcceptedApplication(prisma, options)({
      applicationId: application.id,
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { [specItemId]: "INTERIM" },
    })).rejects.toThrow("fake storage failure");
    await prisma.contract.update({ where: { applicationId: application.id }, data: { clientSignedAt: new Date() } });
    await expect(prepareContractPdfForAcceptedApplication(prisma, options)(application.id))
      .rejects.toMatchObject({ code: "CONTRACT_NOT_PENDING" });
    expect(uploads).toBe(1);
  });

  it("업로드 중 계약이 취소되면 PDF 경로를 덮어쓰지 않는다", async () => {
    const { application, specItemId } = await acceptedApplication();
    const unavailable: ContractStorage = {
      uploadPrivateObject: async () => { throw new Error("fake storage failure"); },
      createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
    };
    await expect(createContractForAcceptedApplication(prisma, { storage: unavailable, bucket: "contracts" })({
      applicationId: application.id,
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { [specItemId]: "INTERIM" },
    })).rejects.toThrow("fake storage failure");
    const storage: ContractStorage = {
      uploadPrivateObject: async () => {
        await prisma.contract.update({ where: { applicationId: application.id }, data: { status: "CANCELLED" } });
      },
      createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
    };
    await expect(prepareContractPdfForAcceptedApplication(prisma, { storage, bucket: "contracts" })(application.id))
      .rejects.toMatchObject({ code: "CONTRACT_CONTENT_MISMATCH" });
    expect(await prisma.contract.findUniqueOrThrow({ where: { applicationId: application.id } }))
      .toMatchObject({ status: "CANCELLED", contentHash: null, pdfUrl: null });
  });

  it("스냅샷의 명세 버전이 계약과 다르면 업로드하지 않는다", async () => {
    const { application, specItemId } = await acceptedApplication();
    let uploads = 0;
    const storage: ContractStorage = {
      uploadPrivateObject: async () => { uploads++; throw new Error("fake storage failure"); },
      createSignedUrl: async () => { throw new Error("다운로드는 호출하지 않아야 합니다."); },
    };
    const options = { storage, bucket: "contracts" };
    await expect(createContractForAcceptedApplication(prisma, options)({
      applicationId: application.id,
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { [specItemId]: "INTERIM" },
    })).rejects.toThrow("fake storage failure");
    await prisma.contract.update({
      where: { applicationId: application.id },
      data: { specSnapshot: {
        specVersionNo: 99,
        projectTitle: "프로젝트",
        clientName: "의뢰인",
        supplierName: "공급자",
        durationDays: 14,
        included: [{ title: "기능", description: "설명", amount: 200_000, installmentStage: "INTERIM" }],
        excluded: [],
      } },
    });
    await expect(prepareContractPdfForAcceptedApplication(prisma, options)(application.id))
      .rejects.toMatchObject({ code: "INVALID_CONTRACT_SCOPE" });
    expect(uploads).toBe(1);
  });
});
