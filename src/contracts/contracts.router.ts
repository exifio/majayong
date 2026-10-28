import { Router } from "express";
import { Role, type PrismaClient } from "@prisma/client";
import { getRequiredAuth } from "../shared/auth.ts";
import {
  createContractForAcceptedApplication,
  createContractWorkflowPorts,
  prepareContractPdfForAcceptedApplication,
} from "../shared/contract-workflow-adapter.ts";
import { AppError, mapTradeError } from "../shared/errors.ts";
import { registerContractRoutes } from "../trade/contract-routes.ts";
import { createContractWorkflow, type ContractStorage } from "../trade/contract-workflow.ts";
import { TradeError } from "../trade/errors.ts";
import { createSignedContractPdfService } from "./signed-contract-pdf-service.ts";

export function createContractApiRouter(input: {
  prismaClient: PrismaClient;
  storage: ContractStorage;
  bucket: string;
}): Router {
  const contractRoutes = Router();
  const apiRouter = Router();
  const workflow = createContractWorkflow(
    createContractWorkflowPorts(input.prismaClient),
    input.storage,
  );
  const createContract = createContractForAcceptedApplication(input.prismaClient, {
    storage: input.storage,
    bucket: input.bucket,
  });
  const prepareContractPdf = prepareContractPdfForAcceptedApplication(input.prismaClient, {
    storage: input.storage,
    bucket: input.bucket,
  });
  const signedPdf = createSignedContractPdfService(input.prismaClient, {
    storage: input.storage,
    bucket: input.bucket,
  });

  registerContractRoutes(contractRoutes, {
    workflow: {
      async createContract(createInput) {
        const { applicationId, actor, interimRatio, installmentStageBySpecItemId } = createInput;
        if (actor.role !== Role.CLIENT) {
          throw new AppError(403, "FORBIDDEN", "의뢰인만 계약을 생성할 수 있습니다.");
        }
        const application = await input.prismaClient.application.findUnique({
          where: { id: applicationId },
          select: {
            totalAmount: true,
            project: { select: { draft: { select: { clientId: true } } } },
          },
        });
        if (!application) {
          throw new AppError(404, "NOT_FOUND", "지원서를 찾을 수 없습니다.");
        }
        if (application.project.draft.clientId !== actor.userId) {
          throw new AppError(403, "FORBIDDEN", "본인 프로젝트의 계약만 생성할 수 있습니다.");
        }

        try {
          return await createContract({
            applicationId,
            agreedAmount: application.totalAmount,
            interimRatio,
            installmentStageBySpecItemId,
          });
        } catch (error: unknown) {
          if (!(error instanceof TradeError) || error.code !== "CONTRACT_ALREADY_EXISTS") throw error;
          const existing = await input.prismaClient.contract.findUnique({
            where: { applicationId },
            select: { pdfUrl: true },
          });
          if (!existing || existing.pdfUrl !== null) throw error;
          await prepareContractPdf(applicationId);
          return input.prismaClient.contract.findUniqueOrThrow({
            where: { applicationId },
            include: { installments: true },
          });
        }
      },
      async sign(signInput) {
        const contract = await workflow.sign(signInput);
        if (contract.status === "ACTIVE") {
          try {
            await signedPdf.prepare(signInput.applicationId);
          } catch {
            // 서명은 이미 확정됐다. 완료본은 다음 다운로드 요청에서 재시도한다.
            console.error("서명 완료 계약서 생성에 실패했습니다.");
          }
        }
        return contract;
      },
      getPdfDownloadUrl: signedPdf.getDownloadUrl,
    },
    bucket: input.bucket,
    getAuth: (request) => {
      const auth = getRequiredAuth(request);
      return { userId: auth.userId, role: auth.role, sessionId: auth.sessionId };
    },
    mapTradeError,
  });

  apiRouter.use("/api/contracts", contractRoutes);
  return apiRouter;
}
