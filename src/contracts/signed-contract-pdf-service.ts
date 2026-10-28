import type { PrismaClient } from "@prisma/client";
import { TradeError } from "../trade/errors.ts";
import { prepareContractPdf, type ContractPdfArtifact } from "../trade/contract-pdf.ts";
import type { ContractActor } from "../trade/contract-workflow.ts";
import { renderContractPdf } from "./contract-pdf-renderer.ts";
import { toPdfDocument, type ContractPdfOptions } from "./contract-pdf-service.ts";

export function createSignedContractPdfService(prisma: PrismaClient, options: ContractPdfOptions) {
  async function prepare(applicationId: string): Promise<ContractPdfArtifact> {
    const contract = await prisma.contract.findUnique({ where: { applicationId } });
    if (!contract) throw new TradeError("CONTRACT_NOT_FOUND");
    if (
      contract.status === "PENDING_CONSENT" ||
      contract.clientSignedAt === null || contract.supplierSignedAt === null ||
      contract.contentHash === null || !/^sha256:[0-9a-f]{64}$/.test(contract.contentHash) ||
      contract.pdfUrl !== `contracts/${contract.id}/${contract.contentHash.slice(7)}.pdf`
    ) throw new TradeError("CONTRACT_NOT_SIGNED");
    const existing = signedArtifact(contract);
    if (existing) return existing;
    if (contract.signedPdfHash !== null || contract.signedPdfUrl !== null) {
      throw new TradeError("CONTRACT_CONTENT_MISMATCH");
    }

    await prepareContractPdf({
      contractId: contract.id,
      bucket: options.bucket,
      storage: options.storage,
      document: {
        ...toPdfDocument(contract),
        clientSignedAt: contract.clientSignedAt,
        supplierSignedAt: contract.supplierSignedAt,
        signedContentHash: contract.contentHash,
      },
      renderPdf: renderContractPdf,
      persistArtifact: async (artifact) => {
        // shortcut: competing uploads may leave an unused private object; add cleanup when deletion is supported.
        await prisma.contract.updateMany({
          where: {
            id: contract.id,
            status: { in: ["ACTIVE", "COMPLETED", "CANCELLED"] },
            contentHash: contract.contentHash,
            pdfUrl: contract.pdfUrl,
            clientSignedAt: contract.clientSignedAt,
            supplierSignedAt: contract.supplierSignedAt,
            signedPdfHash: null,
            signedPdfUrl: null,
          },
          data: { signedPdfHash: artifact.contentHash, signedPdfUrl: artifact.pdfUrl },
        });
      },
    });
    const saved = await prisma.contract.findUnique({ where: { id: contract.id } });
    if (!saved) throw new TradeError("CONTRACT_NOT_FOUND");
    const artifact = signedArtifact(saved);
    if (!artifact) throw new TradeError("CONTRACT_CONTENT_MISMATCH");
    return artifact;
  }

  async function getDownloadUrl(actor: ContractActor, applicationId: string, bucket: string): Promise<string> {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { supplierId: true, project: { select: { draft: { select: { clientId: true } } } } },
    });
    if (!application) throw new TradeError("CONTRACT_NOT_FOUND");
    if (
      !(actor.role === "CLIENT" && actor.userId === application.project.draft.clientId) &&
      !(actor.role === "SUPPLIER" && actor.userId === application.supplierId)
    ) throw new TradeError("CONTRACT_SIGNING_FORBIDDEN");
    const artifact = await prepare(applicationId);
    return options.storage.createSignedUrl({ bucket, path: artifact.pdfUrl, expiresInSeconds: 300, download: true });
  }

  return { prepare, getDownloadUrl };
}

function signedArtifact(contract: { id: string; signedPdfHash: string | null; signedPdfUrl: string | null }): ContractPdfArtifact | null {
  if (
    contract.signedPdfHash === null || !/^sha256:[0-9a-f]{64}$/.test(contract.signedPdfHash) ||
    contract.signedPdfUrl !== `contracts/${contract.id}/${contract.signedPdfHash.slice(7)}.pdf`
  ) return null;
  return { contentHash: contract.signedPdfHash, pdfUrl: contract.signedPdfUrl };
}
