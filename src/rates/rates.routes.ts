import { Router } from "express";
import { Role, type PrismaClient } from "@prisma/client";
import { getRequiredAuth, requireRole } from "../shared/auth.ts";
import { AppError } from "../shared/errors.ts";
import { isRecord } from "../shared/events.ts";
import {
  calculateClientEstimateSummary,
  createSupplierRate,
  estimateBlockPrice,
  estimateBlockPrices,
  listMySupplierRates,
  updateSupplierRate,
  type CreateSupplierRateInput,
  type UpdateSupplierRateInput,
} from "./rates.service.ts";

function parseOptionalPrice(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  throw new AppError(400, "VALIDATION_ERROR", "단가는 숫자 또는 null이어야 합니다.");
}

function parseOptionalBoolean(value: unknown, fieldLabel: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw new AppError(400, "VALIDATION_ERROR", fieldLabel + "는 boolean이어야 합니다.");
}

function parseCreateRateBody(raw: unknown): CreateSupplierRateInput {
  if (!isRecord(raw)) {
    throw new AppError(400, "VALIDATION_ERROR", "요청 본문은 JSON 객체여야 합니다.");
  }
  if (typeof raw.blockId !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "블록 ID가 필요합니다.");
  }
  return {
    blockId: raw.blockId,
    price: parseOptionalPrice(raw.price),
    isCapable: parseOptionalBoolean(raw.isCapable, "수행 가능 여부"),
    isAvgReference: parseOptionalBoolean(raw.isAvgReference, "평균 참고 여부"),
  };
}

function parseUpdateRateBody(raw: unknown): UpdateSupplierRateInput {
  if (!isRecord(raw)) {
    throw new AppError(400, "VALIDATION_ERROR", "요청 본문은 JSON 객체여야 합니다.");
  }
  return {
    price: parseOptionalPrice(raw.price),
    isCapable: parseOptionalBoolean(raw.isCapable, "수행 가능 여부"),
    isAvgReference: parseOptionalBoolean(raw.isAvgReference, "평균 참고 여부"),
  };
}

export function createRatesRouter(prismaClient: PrismaClient): Router {
  const router = Router();

  router.get("/api/supplier/rates", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    const result = await listMySupplierRates(prismaClient, auth.userId);
    res.json(result);
  });

  router.post("/api/supplier/rates", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    const body: unknown = req.body;
    const result = await createSupplierRate(
      prismaClient,
      auth.userId,
      parseCreateRateBody(body),
      auth.sessionId,
    );
    res.status(201).json(result);
  });

  router.patch("/api/supplier/rates/:blockId", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    const body: unknown = req.body;
    const result = await updateSupplierRate(
      prismaClient,
      auth.userId,
      String(req.params.blockId),
      parseUpdateRateBody(body),
      auth.sessionId,
    );
    res.json(result);
  });

  // 의뢰인용 예상 단가·범위(estUnit/estMin/estMax)는 공급자에게 노출하지 않는다(PRD F-05 · AGENTS 8절)
  router.get("/api/blocks/estimates", requireRole(Role.CLIENT, Role.ADMIN), async (req, res) => {
    const raw = typeof req.query.blockIds === "string" ? req.query.blockIds : "";
    const blockIds = raw.split(",").map((id) => id.trim()).filter(Boolean);
    if (blockIds.length === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "조회할 blockIds 쿼리 파라미터가 필요합니다.");
    }
    const items = await estimateBlockPrices(prismaClient, blockIds);
    res.json({
      items,
      summary: calculateClientEstimateSummary(items),
    });
  });

  router.get("/api/blocks/:blockId/estimate", requireRole(Role.CLIENT, Role.ADMIN), async (req, res) => {
    const estimate = await estimateBlockPrice(prismaClient, String(req.params.blockId));
    res.json(estimate);
  });

  return router;
}
