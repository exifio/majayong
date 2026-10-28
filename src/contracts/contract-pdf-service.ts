import type { Prisma, PrismaClient } from "@prisma/client";
import { isRecord } from "../shared/events.ts";
import { TradeError } from "../trade/errors.ts";
import { prepareContractPdf, type ContractPdfArtifact } from "../trade/contract-pdf.ts";
import type { ContractStorage } from "../trade/contract-workflow.ts";
import type { ExcludedReason } from "../trade/contract.ts";
import { renderContractPdf, type ContractPdfDocument } from "./contract-pdf-renderer.ts";

export interface ContractPdfOptions {
  storage: ContractStorage;
  bucket: string;
}

export function prepareContractPdfForAcceptedApplication(prismaClient: PrismaClient, options: ContractPdfOptions) {
  if (!options?.bucket?.trim() || !options.storage) throw new TradeError("CONTRACT_PDF_UPLOAD_FAILED");
  const bucket = options.bucket.trim();
  return async (applicationId: string): Promise<ContractPdfArtifact> => {
    const contract = await prismaClient.contract.findUnique({ where: { applicationId } });
    if (!contract) throw new TradeError("CONTRACT_NOT_FOUND");
    if (contract.status !== "PENDING_CONSENT") throw new TradeError("CONTRACT_NOT_PENDING");
    const existing = storedArtifact(contract);
    if (existing) return existing;
    if (contract.contentHash !== null || contract.pdfUrl !== null) throw new TradeError("CONTRACT_CONTENT_MISMATCH");
    if (contract.clientSignedAt !== null || contract.supplierSignedAt !== null) {
      throw new TradeError("CONTRACT_NOT_PENDING");
    }

    await prepareContractPdf({
      contractId: contract.id,
      bucket,
      document: toPdfDocument(contract),
      renderPdf: renderContractPdf,
      storage: options.storage,
      persistArtifact: async (artifact) => {
        // shortcut: concurrent uploads may leave an unused private object; add cleanup when deletion is supported.
        await prismaClient.contract.updateMany({
          where: {
            id: contract.id,
            status: "PENDING_CONSENT",
            contentHash: null,
            pdfUrl: null,
            clientSignedAt: null,
            supplierSignedAt: null,
          },
          data: artifact,
        });
      },
    });

    const saved = await prismaClient.contract.findUnique({ where: { id: contract.id } });
    if (!saved) throw new TradeError("CONTRACT_NOT_FOUND");
    const artifact = storedArtifact(saved);
    if (!artifact) throw new TradeError("CONTRACT_CONTENT_MISMATCH");
    return artifact;
  };
}

function storedArtifact(contract: { id: string; contentHash: string | null; pdfUrl: string | null }): ContractPdfArtifact | null {
  if (
    contract.contentHash === null ||
    !/^sha256:[0-9a-f]{64}$/.test(contract.contentHash) ||
    contract.pdfUrl !== `contracts/${contract.id}/${contract.contentHash.slice(7)}.pdf`
  ) return null;
  return { contentHash: contract.contentHash, pdfUrl: contract.pdfUrl };
}

export function toPdfDocument(contract: {
  id: string;
  specVersionNo: number;
  agreedAmount: number;
  specSnapshot: Prisma.JsonValue;
}): ContractPdfDocument {
  const snapshot = contract.specSnapshot;
  if (
    !isRecord(snapshot) ||
    typeof snapshot.projectTitle !== "string" || !snapshot.projectTitle.trim() ||
    typeof snapshot.clientName !== "string" || !snapshot.clientName.trim() ||
    typeof snapshot.supplierName !== "string" || !snapshot.supplierName.trim() ||
    snapshot.specVersionNo !== contract.specVersionNo ||
    typeof snapshot.durationDays !== "number" || !Number.isSafeInteger(snapshot.durationDays) || snapshot.durationDays < 1 ||
    !Array.isArray(snapshot.included) || snapshot.included.length === 0 ||
    !Array.isArray(snapshot.excluded)
  ) throw new TradeError("INVALID_CONTRACT_SCOPE");

  const includedItems: ContractPdfDocument["includedItems"] = snapshot.included.map((item: unknown) => {
    if (
      !isRecord(item) || typeof item.title !== "string" || !item.title.trim() ||
      typeof item.description !== "string" ||
      (item.installmentStage !== "INTERIM" && item.installmentStage !== "FINAL") ||
      (item.amount !== null && (typeof item.amount !== "number" || !Number.isSafeInteger(item.amount) || item.amount < 0))
    ) throw new TradeError("INVALID_CONTRACT_SCOPE");
    return { title: item.title, description: item.description, amount: item.amount, installmentStage: item.installmentStage };
  });

  const excludedItems: ContractPdfDocument["excludedItems"] = snapshot.excluded.map((item: unknown) => {
    if (!isRecord(item) || typeof item.title !== "string" || !item.title.trim() || !isExcludedReason(item.reason)) {
      throw new TradeError("INVALID_CONTRACT_SCOPE");
    }
    return { title: item.title, reason: item.reason };
  });

  return {
    contractId: contract.id,
    projectTitle: snapshot.projectTitle,
    clientName: snapshot.clientName,
    supplierName: snapshot.supplierName,
    specVersionNo: contract.specVersionNo,
    agreedAmount: contract.agreedAmount,
    durationDays: snapshot.durationDays,
    includedItems,
    excludedItems,
    clientSignedAt: null,
    supplierSignedAt: null,
  };
}

function isExcludedReason(value: unknown): value is ExcludedReason {
  return value === "SPEC_EXCLUDED" || value === "SPEC_NEEDS_CONFIRMATION" || value === "NOT_QUOTED" || value === "SUPPLIER_UNAVAILABLE";
}
