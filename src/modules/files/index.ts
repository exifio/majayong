import { randomUUID } from "node:crypto";

export class FileHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FileHttpError";
    this.status = status;
  }
}

export type FilePurpose = "DELIVERY" | "PORTFOLIO" | "SUPPORT_INQUIRY" | "CONTRACT_DOCUMENT";

export interface FileEntity {
  id: string;
  purpose: FilePurpose;
  contractId?: string;
  inquiryId?: string;
  uploaderId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
}

export interface FileContractEntity {
  id: string;
  clientUserId: string;
  supplierUserId: string;
}

export interface FileStorageAdapter {
  createUploadUrl(
    bucket: string,
    objectKey: string,
    expiresInSec: number,
  ): Promise<{ uploadUrl: string; expiresInSec: number }>;
  createDownloadUrl(
    bucket: string,
    objectKey: string,
    expiresInSec: number,
  ): Promise<{ downloadUrl: string; expiresInSec: number }>;
}

export interface FileRepository {
  seedContract(contract: FileContractEntity): void;
  getContract(id: string): Promise<FileContractEntity | null>;
  saveFileMetadata(data: Omit<FileEntity, "id" | "createdAt">): Promise<FileEntity>;
  getFileMetadata(id: string): Promise<FileEntity | null>;
  countFilesInquiry(inquiryId: string): Promise<number>;
}

export function createInMemoryFileRepository(): FileRepository {
  const contracts = new Map<string, FileContractEntity>();
  const files = new Map<string, FileEntity>();
  let idCounter = 1;

  return {
    seedContract(contract) {
      contracts.set(contract.id, { ...contract });
    },
    async getContract(id) {
      return contracts.get(id) ?? null;
    },
    async saveFileMetadata(data) {
      const id = `file-${idCounter++}`;
      const rec: FileEntity = { ...data, id, createdAt: new Date() };
      files.set(id, rec);
      return rec;
    },
    async getFileMetadata(id) {
      return files.get(id) ?? null;
    },
    async countFilesInquiry(inquiryId) {
      let count = 0;
      for (const f of files.values()) {
        if (f.inquiryId === inquiryId) count++;
      }
      return count;
    },
  };
}

const ALLOWED_EXTENSIONS: Record<string, true> = {
  ".png": true,
  ".jpg": true,
  ".jpeg": true,
  ".webp": true,
  ".pdf": true,
  ".zip": true,
  ".mp4": true,
  ".txt": true,
};

export function sanitizeFileName(name: string): string {
  const base = name.replace(/[\/\\]/g, "").replace(/\.\./g, "").replace(/\0/g, "");
  return base.trim() || "unnamed";
}

export interface FileServiceOptions {
  repo: FileRepository;
  storageAdapter: FileStorageAdapter;
  clock?: { now(): Date };
}

export class FileService {
  private readonly repo: FileRepository;
  private readonly storageAdapter: FileStorageAdapter;
  private readonly clock: { now(): Date };

  constructor(options: FileServiceOptions) {
    this.repo = options.repo;
    this.storageAdapter = options.storageAdapter;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async createPresignedUpload(
    actor: { userId: string; role: string },
    input: {
      purpose: FilePurpose;
      contractId?: string;
      inquiryId?: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    },
  ): Promise<{ uploadUrl: string; objectKey: string; expiresInSec: number }> {
    if (!actor.userId || actor.role === "UNKNOWN") {
      throw new FileHttpError(403, "파일 업로드 권한이 없습니다. 유효한 로그인 계정이 필요합니다.");
    }

    const lowerName = input.fileName.toLowerCase();
    const extMatch = lowerName.match(/\.[a-z0-9]+$/);
    const ext = extMatch ? extMatch[0] : "";

    if (!ALLOWED_EXTENSIONS[ext]) {
      throw new FileHttpError(400, `지원하지 않는 파일 형식입니다: ${ext || "알 수 없음"}`);
    }

    const isSupportInquiry = input.purpose === "SUPPORT_INQUIRY";
    const maxLimit = isSupportInquiry ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    const limitLabel = isSupportInquiry ? "10MB" : "50MB";

    if (input.fileSize > maxLimit) {
      throw new FileHttpError(400, `파일 크기가 제한(${limitLabel})을 초과합니다.`);
    }

    if (isSupportInquiry && input.inquiryId) {
      const count = await this.repo.countFilesInquiry(input.inquiryId);
      if (count >= 3) {
        throw new FileHttpError(400, "1:1 문의 첨부파일은 최대 3개까지만 업로드할 수 있습니다.");
      }
    }

    if (input.purpose === "DELIVERY" && input.contractId) {
      const contract = await this.repo.getContract(input.contractId);
      if (!contract) throw new FileHttpError(404, "계약을 찾을 수 없습니다.");
      if (actor.userId !== contract.supplierUserId) {
        throw new FileHttpError(403, "계약 납품 파일은 담당 공급자만 업로드할 수 있습니다.");
      }
    }

    const safeBaseName = sanitizeFileName(input.fileName);
    const scopeFolder = input.contractId ?? input.inquiryId ?? actor.userId;
    const objectKey = `${input.purpose.toLowerCase()}/${scopeFolder}/${randomUUID()}/${safeBaseName}`;

    const expiresInSec = 300;
    const presign = await this.storageAdapter.createUploadUrl("private-assets", objectKey, expiresInSec);

    return {
      uploadUrl: presign.uploadUrl,
      objectKey,
      expiresInSec,
    };
  }

  async createPresignedDownload(
    actor: { userId: string; role: string },
    fileId: string,
  ): Promise<{ downloadUrl: string; expiresInSec: number }> {
    const file = await this.repo.getFileMetadata(fileId);
    if (!file) throw new FileHttpError(404, "파일 메타데이터를 찾을 수 없습니다.");

    if (file.contractId) {
      const contract = await this.repo.getContract(file.contractId);
      if (!contract) throw new FileHttpError(404, "관련 계약을 찾을 수 없습니다.");

      const isParty =
        actor.role === "ADMIN" ||
        actor.userId === contract.clientUserId ||
        actor.userId === contract.supplierUserId;

      if (!isParty) {
        throw new FileHttpError(403, "해당 파일에 대한 접근 권한이 없습니다.");
      }
    } else {
      if (actor.role !== "ADMIN" && actor.userId !== file.uploaderId) {
        throw new FileHttpError(403, "본인이 업로드한 파일만 다운로드할 수 있습니다.");
      }
    }

    const expiresInSec = 180;
    return this.storageAdapter.createDownloadUrl("private-assets", file.objectKey, expiresInSec);
  }
}
