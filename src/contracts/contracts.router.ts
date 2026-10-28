import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { getRequiredAuth } from "../shared/auth.ts";
import { createContractWorkflowPorts } from "../shared/contract-workflow-adapter.ts";
import { mapTradeError } from "../shared/errors.ts";
import { registerContractRoutes } from "../trade/contract-routes.ts";
import { createContractWorkflow, type ContractStorage } from "../trade/contract-workflow.ts";

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

  registerContractRoutes(contractRoutes, {
    workflow,
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
