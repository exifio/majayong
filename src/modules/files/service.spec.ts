import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FileService,
  FileHttpError,
  createInMemoryFileRepository,
} from "./index.ts";

describe("C-08: 파일 presign·권한 관리", () => {
  const baseTime = new Date("2026-11-28T10:00:00.000Z");

  function createTestSetup() {
    const repo = createInMemoryFileRepository();

    const contract = {
      id: "contract-c08",
      clientUserId: "client-c08",
      supplierUserId: "supplier-c08",
    };

    repo.seedContract(contract);

    const storageAdapter = {
      async createUploadUrl(bucket: string, objectKey: string, expiresInSec: number) {
        return {
          uploadUrl: `https://mock.storage.supabase.co/${bucket}/${objectKey}?token=mock_upload_token`,
          expiresInSec,
        };
      },
      async createDownloadUrl(bucket: string, objectKey: string, expiresInSec: number) {
        return {
          downloadUrl: `https://mock.storage.supabase.co/${bucket}/${objectKey}?token=mock_download_token`,
          expiresInSec,
        };
      },
    };

    const service = new FileService({
      repo,
      storageAdapter,
      clock: { now: () => baseTime },
    });

    return { repo, contract, service };
  }

  it("C-08-T01 외부인 presign 403", async () => {
    const { service } = createTestSetup();

    // 인증되지 않은 또는 허용되지 않은 사용자 presign 시도 -> 403
    await assert.rejects(
      () =>
        service.createPresignedUpload(
          { userId: "unauthorized-stranger", role: "UNKNOWN" },
          {
            purpose: "DELIVERY",
            contractId: "contract-c08",
            fileName: "output.zip",
            fileSize: 1024 * 1024,
            mimeType: "application/zip",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof FileHttpError)) return false;
        assert.equal(err.status, 403);
        assert.match(err.message, /권한이 없습니다/);
        return true;
      },
    );
  });

  it("C-08-T02 다른 계약 파일 접근 거절", async () => {
    const { service, contract, repo } = createTestSetup();

    // contract-c08 소유 파일 등록
    const file = await repo.saveFileMetadata({
      purpose: "DELIVERY",
      contractId: contract.id,
      uploaderId: contract.supplierUserId,
      objectKey: `delivery/${contract.id}/uuid-1234/test.pdf`,
      fileName: "test.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    });

    // 다른 계약의 의뢰인이 해당 파일 다운로드 presign 시도 -> 403 거부
    await assert.rejects(
      () =>
        service.createPresignedDownload(
          { userId: "other-client", role: "CLIENT" },
          file.id,
        ),
      (err: unknown) => {
        if (!(err instanceof FileHttpError)) return false;
        assert.equal(err.status, 403);
        assert.match(err.message, /접근 권한이 없습니다/);
        return true;
      },
    );

    // 해당 계약 당사자(의뢰인)는 정상 접근 가능
    const access = await service.createPresignedDownload(
      { userId: contract.clientUserId, role: "CLIENT" },
      file.id,
    );
    assert.ok(access.downloadUrl);
  });

  it("C-08-T03 확장자·크기 제한", async () => {
    const { service, contract } = createTestSetup();

    // 1. 금지된 확장자 (.exe 실행 파일)
    await assert.rejects(
      () =>
        service.createPresignedUpload(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          {
            purpose: "DELIVERY",
            contractId: contract.id,
            fileName: "trojan.exe",
            fileSize: 1024,
            mimeType: "application/x-msdownload",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof FileHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /지원하지 않는 파일 형식/);
        return true;
      },
    );

    // 2. 최대 50MB 초과
    await assert.rejects(
      () =>
        service.createPresignedUpload(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          {
            purpose: "DELIVERY",
            contractId: contract.id,
            fileName: "huge.zip",
            fileSize: 55 * 1024 * 1024, // 55MB
            mimeType: "application/zip",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof FileHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /50MB/);
        return true;
      },
    );
  });

  it("C-08-T04 경로 삽입/디렉터리 탈출 방지", async () => {
    const { service, contract } = createTestSetup();

    // 디렉터리 탐색 (path traversal) 시도: "../../etc/passwd"
    const presign = await service.createPresignedUpload(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      {
        purpose: "DELIVERY",
        contractId: contract.id,
        fileName: "../../etc/passwd.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
      },
    );

    // 서버가 생성한 objectKey에 ..나 /etc/가 포함되지 않고 안전한 무작위 식별자로 격리됨
    assert.equal(presign.objectKey.includes(".."), false);
    assert.equal(presign.objectKey.startsWith("delivery/"), true);
  });

  it("C-08-T05 만료 URL·service key 미노출", async () => {
    const { service, contract, repo } = createTestSetup();

    const file = await repo.saveFileMetadata({
      purpose: "DELIVERY",
      contractId: contract.id,
      uploaderId: contract.supplierUserId,
      objectKey: `delivery/${contract.id}/safe-id/file.pdf`,
      fileName: "file.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    });

    const access = await service.createPresignedDownload(
      { userId: contract.clientUserId, role: "CLIENT" },
      file.id,
    );

    // service-role 키나 master secret이 URL에 노출되지 않음
    assert.equal(access.downloadUrl.includes("service_role"), false);
    assert.equal(access.downloadUrl.includes("supabase_secret"), false);
    // 짧은 수명 (300초 이하)
    assert.ok(access.expiresInSec <= 300);
  });

  it("C-08-T06 문의 첨부 4개/10MB 초과 거부", async () => {
    const { service, repo } = createTestSetup();

    // 1. 문의 파일당 10MB 초과 거부
    await assert.rejects(
      () =>
        service.createPresignedUpload(
          { userId: "inquiry-user-1", role: "CLIENT" },
          {
            purpose: "SUPPORT_INQUIRY",
            inquiryId: "inq-100",
            fileName: "large_log.txt",
            fileSize: 11 * 1024 * 1024, // 11MB
            mimeType: "text/plain",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof FileHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /10MB/);
        return true;
      },
    );

    // 3개 정상 등록
    for (let i = 1; i <= 3; i++) {
      await repo.saveFileMetadata({
        purpose: "SUPPORT_INQUIRY",
        inquiryId: "inq-100",
        uploaderId: "inquiry-user-1",
        objectKey: `inquiry/inq-100/file-${i}.png`,
        fileName: `file-${i}.png`,
        fileSize: 1024,
        mimeType: "image/png",
      });
    }

    // 2. 4번째 첨부 시도 -> 400 거부 (문의 첨부 최대 3개 초과)
    await assert.rejects(
      () =>
        service.createPresignedUpload(
          { userId: "inquiry-user-1", role: "CLIENT" },
          {
            purpose: "SUPPORT_INQUIRY",
            inquiryId: "inq-100",
            fileName: "file-4.png",
            fileSize: 1024,
            mimeType: "image/png",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof FileHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /최대 3개/);
        return true;
      },
    );
  });

  it("C-08-F01 목적별 필수 ID·역할·MIME 검증", async () => {
    const { service, contract } = createTestSetup();
    const supplier = { userId: contract.supplierUserId, role: "SUPPLIER" };
    const client = { userId: contract.clientUserId, role: "CLIENT" };

    // 전달 목적에 contractId가 없으면 권한 검사를 우회하지 못한다.
    await assert.rejects(
      () =>
        service.createPresignedUpload(supplier, {
          purpose: "DELIVERY",
          fileName: "result.pdf",
          fileSize: 1024,
          mimeType: "application/pdf",
        }),
      (err: unknown) => err instanceof FileHttpError && err.status === 400,
    );

    await assert.rejects(
      () =>
        service.createPresignedUpload(client, {
          purpose: "SUPPORT_INQUIRY",
          fileName: "log.txt",
          fileSize: 1024,
          mimeType: "text/plain",
        }),
      (err: unknown) => err instanceof FileHttpError && err.status === 400,
    );

    // 포트폴리오는 공급자만.
    await assert.rejects(
      () =>
        service.createPresignedUpload(client, {
          purpose: "PORTFOLIO",
          fileName: "portfolio.pdf",
          fileSize: 1024,
          mimeType: "application/pdf",
        }),
      (err: unknown) => err instanceof FileHttpError && err.status === 403,
    );
    const portfolio = await service.createPresignedUpload(supplier, {
      purpose: "PORTFOLIO",
      fileName: "portfolio.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    });
    assert.ok(portfolio.fileId);

    // 계약 문서도 대상 계약과 당사자 확인이 필요하다.
    await assert.rejects(
      () =>
        service.createPresignedUpload(client, {
          purpose: "CONTRACT_DOCUMENT",
          fileName: "contract.pdf",
          fileSize: 1024,
          mimeType: "application/pdf",
        }),
      (err: unknown) => err instanceof FileHttpError && err.status === 400,
    );
    const document = await service.createPresignedUpload(client, {
      purpose: "CONTRACT_DOCUMENT",
      contractId: contract.id,
      fileName: "contract.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    });
    assert.ok(document.fileId);

    // 확장자와 MIME이 다르거나 빈 MIME은 거부.
    await assert.rejects(
      () =>
        service.createPresignedUpload(supplier, {
          purpose: "DELIVERY",
          contractId: contract.id,
          fileName: "fake.pdf",
          fileSize: 1024,
          mimeType: "image/png",
        }),
      (err: unknown) => err instanceof FileHttpError && err.status === 400,
    );
    await assert.rejects(
      () =>
        service.createPresignedUpload(supplier, {
          purpose: "DELIVERY",
          contractId: contract.id,
          fileName: "empty.pdf",
          fileSize: 1024,
          mimeType: "",
        }),
      (err: unknown) => err instanceof FileHttpError && err.status === 400,
    );

    await assert.rejects(
      () =>
        service.createPresignedUpload(supplier, {
          purpose: "UNKNOWN" as never,
          fileName: "file.pdf",
          fileSize: 1024,
          mimeType: "application/pdf",
        }),
      (err: unknown) => err instanceof FileHttpError && err.status === 400,
    );
  });

  it("C-08-F02 presign이 메타데이터를 저장하고 저장 내역으로 제한·다운로드 권한을 강제", async () => {
    const { service, repo, contract } = createTestSetup();
    const supplier = { userId: contract.supplierUserId, role: "SUPPLIER" };
    const inquiryUser = { userId: "inquiry-user-2", role: "CLIENT" };

    const presigned = await service.createPresignedUpload(supplier, {
      purpose: "DELIVERY",
      contractId: contract.id,
      fileName: "result.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    });
    const stored = await repo.getFileMetadata(presigned.fileId);
    assert.ok(stored);
    assert.equal(stored.objectKey, presigned.objectKey);
    assert.equal(stored.uploaderId, contract.supplierUserId);
    assert.equal(stored.fileSize, 1024);

    // 메타데이터가 있는 본인/당사자 다운로드는 허용.
    const ownerDownload = await service.createPresignedDownload(supplier, presigned.fileId);
    assert.ok(ownerDownload.downloadUrl);
    const clientDownload = await service.createPresignedDownload(
      { userId: contract.clientUserId, role: "CLIENT" },
      presigned.fileId,
    );
    assert.ok(clientDownload.downloadUrl);

    await assert.rejects(
      () => service.createPresignedDownload({ userId: "alien", role: "CLIENT" }, "missing-file"),
      (err: unknown) => err instanceof FileHttpError && err.status === 404,
    );

    // presign 재요청도 실제 저장 건수에 누적되어 4번째 문의 첨부는 차단.
    const inquiryFileIds: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const res = await service.createPresignedUpload(inquiryUser, {
        purpose: "SUPPORT_INQUIRY",
        inquiryId: "inq-f02",
        fileName: `inquiry-${i}.png`,
        fileSize: 1024,
        mimeType: "image/png",
      });
      assert.ok(res.fileId);
      inquiryFileIds.push(res.fileId);
    }
    await assert.rejects(
      () =>
        service.createPresignedUpload(inquiryUser, {
          purpose: "SUPPORT_INQUIRY",
          inquiryId: "inq-f02",
          fileName: "inquiry-4.png",
          fileSize: 1024,
          mimeType: "image/png",
        }),
      (err: unknown) => err instanceof FileHttpError && err.status === 400,
    );

    // 문의 파일은 업로더 본인만 다운로드.
    await assert.rejects(
      () => service.createPresignedDownload({ userId: "alien", role: "CLIENT" }, inquiryFileIds[0]),
      (err: unknown) => err instanceof FileHttpError && err.status === 403,
    );
    const ownInquiryFile = await service.createPresignedDownload(inquiryUser, inquiryFileIds[0]);
    assert.ok(ownInquiryFile.downloadUrl);
  });
});
