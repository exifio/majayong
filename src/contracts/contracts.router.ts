import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { getRequiredAuth } from "../shared/auth.ts";
import { createContractWorkflowPorts } from "../shared/contract-workflow-adapter.ts";
import { mapTradeError } from "../shared/errors.ts";
import { registerContractRoutes } from "../trade/contract-routes.ts";
import { createContractWorkflow, type ContractStorage } from "../trade/contract-workflow.ts";
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
  const signedPdf = createSignedContractPdfService(input.prismaClient, {
    storage: input.storage,
    bucket: input.bucket,
  });

  registerContractRoutes(contractRoutes, {
    workflow: {
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
