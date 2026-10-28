import { Role, type PrismaClient } from "@prisma/client";
import { Router, type Request } from "express";
import { createPaymentWorkflow } from "../trade/payment-workflow.ts";
import { registerPaymentRoutes } from "../trade/payment-routes.ts";
import { confirmTossPayment, type TossConfirmationRequest } from "../trade/toss-payments.ts";
import type { PgCallback } from "../trade/payment.ts";
import { createPaymentWorkflowPorts } from "../shared/payment-workflow-adapter.ts";
import { createReviewWorkflow } from "../trade/review-workflow.ts";
import { registerReviewRoutes } from "../trade/review-routes.ts";
import { createCancellationWorkflow } from "../trade/cancellation-workflow.ts";
import { registerCancellationRoutes } from "../trade/cancellation-routes.ts";
import type { InspectionReason } from "../trade/settlement.ts";
import { TradeError } from "../trade/errors.ts";
import {
  createSettlementWorkflowAdapter,
  type TradeActor,
} from "../shared/settlement-workflow-adapter.ts";
import { createReviewWorkflowPorts } from "../shared/review-workflow-adapter.ts";
import { createCancellationWorkflowPorts } from "../shared/cancellation-workflow-adapter.ts";
import { getRequiredAuth } from "../shared/auth.ts";
import { mapTradeError } from "../shared/errors.ts";
import { isRecord } from "../shared/events.ts";

export function createTradeApiRouter(input: {
  prismaClient: PrismaClient;
  confirmPayment?: (request: TossConfirmationRequest) => Promise<PgCallback>;
}): Router {
  const apiRouter = Router();
  const contractRoutes = Router();
  const reviewWorkflow = createReviewWorkflow(createReviewWorkflowPorts(input.prismaClient));
  const cancellationWorkflow = createCancellationWorkflow(
    createCancellationWorkflowPorts(input.prismaClient),
  );
  const settlement = createSettlementWorkflowAdapter(input.prismaClient);
  const paymentWorkflow = createPaymentWorkflow(
    createPaymentWorkflowPorts(input.prismaClient),
    input.confirmPayment ?? ((request) => {
      const testSecretKey = process.env.TOSS_TEST_SECRET_KEY;
      if (!testSecretKey) throw new TradeError("TOSS_TEST_KEY_REQUIRED");
      return confirmTossPayment(testSecretKey, request);
    }),
  );

  registerPaymentRoutes(contractRoutes, {
    workflow: paymentWorkflow,
    getAuth: getTradeActor,
    mapTradeError,
  });

  registerReviewRoutes(contractRoutes, {
    workflow: reviewWorkflow,
    getAuth: (request) => {
      const auth = getRequiredAuth(request);
      if (auth.role !== Role.CLIENT && auth.role !== Role.SUPPLIER) {
        throw new TradeError("REVIEW_FORBIDDEN");
      }
      return { userId: auth.userId, role: auth.role };
    },
    mapTradeError,
  });

  registerCancellationRoutes(contractRoutes, {
    workflow: cancellationWorkflow,
    getAuth: getTradeActor,
    mapTradeError,
  });

  contractRoutes.post("/:contractId/installments/:installmentId/deliveries", async (req, res, next) => {
    try {
      const body = parseDeliveryBody(req.body);
      const result = await settlement.submitDelivery({
        contractId: getParam(req.params.contractId, "CONTRACT_ID_REQUIRED"),
        installmentId: getParam(req.params.installmentId, "INSTALLMENT_ID_REQUIRED"),
        actor: getTradeActor(req),
        ...body,
        submittedAt: new Date(),
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      next(mapRouteError(error));
    }
  });

  contractRoutes.post("/:contractId/deliveries/:deliveryId/inspection", async (req, res, next) => {
    try {
      const requests = parseInspectionBody(req.body);
      const result = await settlement.inspectDelivery({
        contractId: getParam(req.params.contractId, "CONTRACT_ID_REQUIRED"),
        deliveryId: getParam(req.params.deliveryId, "DELIVERY_ID_REQUIRED"),
        actor: getTradeActor(req),
        requests,
        reviewedAt: new Date(),
      });
      res.json(result);
    } catch (error: unknown) {
      next(mapRouteError(error));
    }
  });

  contractRoutes.post("/:contractId/installments/:installmentId/release", async (req, res, next) => {
    try {
      const result = await settlement.releaseInstallment({
        contractId: getParam(req.params.contractId, "CONTRACT_ID_REQUIRED"),
        installmentId: getParam(req.params.installmentId, "INSTALLMENT_ID_REQUIRED"),
        actor: getTradeActor(req),
        releasedAt: new Date(),
      });
      res.json(result);
    } catch (error: unknown) {
      next(mapRouteError(error));
    }
  });

  apiRouter.use("/api/contracts", contractRoutes);
  return apiRouter;
}

function getTradeActor(request: Request): TradeActor {
  const auth = getRequiredAuth(request);
  return { userId: auth.userId, role: auth.role, sessionId: auth.sessionId };
}

function parseDeliveryBody(body: unknown): { summary: string | null; fileUrl: string | null } {
  if (!isRecord(body)) throw new TradeError("INVALID_DELIVERY_BODY");
  return {
    summary: getNullableString(body, "summary", "INVALID_DELIVERY_SUMMARY"),
    fileUrl: getNullableString(body, "fileUrl", "INVALID_DELIVERY_FILE_URL"),
  };
}

function parseInspectionBody(
  body: unknown,
): { applicationItemId: string; reason: InspectionReason; note: string | null }[] {
  if (!isRecord(body) || !Array.isArray(body.requests)) throw new TradeError("INVALID_INSPECTION_BODY");
  return body.requests.map((value: unknown) => {
    if (!isRecord(value) || typeof value.applicationItemId !== "string" || !value.applicationItemId.trim()) {
      throw new TradeError("INVALID_INSPECTION_ITEM");
    }
    if (
      value.reason !== "IN_SPEC" &&
      value.reason !== "NOT_IN_SPEC" &&
      value.reason !== "INTERPRETATION"
    ) {
      throw new TradeError("INVALID_INSPECTION_REASON");
    }
    return {
      applicationItemId: value.applicationItemId,
      reason: value.reason,
      note: getNullableString(value, "note", "INVALID_INSPECTION_NOTE"),
    };
  });
}

function getNullableString(record: Record<string, unknown>, key: string, errorCode: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  throw new TradeError(errorCode);
}

function getParam(value: string | undefined, errorCode: string): string {
  if (!value?.trim()) throw new TradeError(errorCode);
  return value;
}

function mapRouteError(error: unknown): unknown {
  return error instanceof TradeError ? mapTradeError(error) : error;
}
