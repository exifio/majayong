import { Role, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import { getRequiredAuth, requireRole } from "../shared/auth.ts";
import { AppError } from "../shared/errors.ts";
import { isRecord } from "../shared/events.ts";
import {
  acceptApplication,
  compareApplications,
  rejectApplication,
  submitApplication,
  type AcceptApplicationInput,
  type ApplicationItemInput,
} from "./applications.service.ts";

function parseSubmitBody(raw: unknown): { durationDays: number; items: ApplicationItemInput[] } {
  if (!isRecord(raw) || typeof raw.durationDays !== "number" || !Number.isSafeInteger(raw.durationDays) || !Array.isArray(raw.items)) {
    throw new AppError(400, "VALIDATION_ERROR", "소요일수와 항목별 견적이 필요합니다.");
  }
  const items = raw.items.map((value: unknown): ApplicationItemInput => {
    if (!isRecord(value) || typeof value.specItemId !== "string" || typeof value.isAvailable !== "boolean") {
      throw new AppError(400, "VALIDATION_ERROR", "견적 항목 형식이 올바르지 않습니다.");
    }
    const amount = value.amount;
    if (amount !== undefined && amount !== null && typeof amount !== "number") {
      throw new AppError(400, "VALIDATION_ERROR", "항목 금액은 숫자 또는 null이어야 합니다.");
    }
    const memo = value.memo;
    if (memo !== undefined && memo !== null && typeof memo !== "string") {
      throw new AppError(400, "VALIDATION_ERROR", "메모는 문자 또는 null이어야 합니다.");
    }
    return {
      specItemId: value.specItemId,
      isAvailable: value.isAvailable,
      amount,
      memo,
    };
  });
  return { durationDays: raw.durationDays, items };
}

function parseAcceptBody(raw: unknown): AcceptApplicationInput {
  if (!isRecord(raw) || !Array.isArray(raw.confirmedExcludedItemIds)) {
    throw new AppError(400, "VALIDATION_ERROR", "제외 항목 확인 정보가 필요합니다.");
  }
  const confirmedExcludedItemIds = raw.confirmedExcludedItemIds.map((value: unknown) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "제외 항목 ID 형식이 올바르지 않습니다.");
    }
    return value;
  });
  const firstSentenceExclusionConfirmed = raw.firstSentenceExclusionConfirmed ?? false;
  if (typeof firstSentenceExclusionConfirmed !== "boolean") {
    throw new AppError(400, "VALIDATION_ERROR", "첫 문장 제외 확인 값은 boolean이어야 합니다.");
  }
  return { confirmedExcludedItemIds, firstSentenceExclusionConfirmed };
}

export function createApplicationsRouter(prismaClient: PrismaClient): Router {
  const router = Router();

  router.post("/api/projects/:projectId/applications", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    const result = await submitApplication(
      prismaClient,
      String(req.params.projectId),
      auth.userId,
      parseSubmitBody(req.body),
      auth.sessionId,
    );
    res.status(201).json(result);
  });

  router.get("/api/projects/:projectId/applications/compare", requireRole(Role.CLIENT), async (req, res) => {
    const auth = getRequiredAuth(req);
    res.json(await compareApplications(prismaClient, String(req.params.projectId), auth.userId));
  });

  router.post("/api/applications/:applicationId/accept", requireRole(Role.CLIENT), async (req, res) => {
    const auth = getRequiredAuth(req);
    res.json(await acceptApplication(
      prismaClient,
      String(req.params.applicationId),
      auth.userId,
      parseAcceptBody(req.body),
      auth.sessionId,
    ));
  });

  router.post("/api/applications/:applicationId/reject", requireRole(Role.CLIENT), async (req, res) => {
    const auth = getRequiredAuth(req);
    res.json(await rejectApplication(prismaClient, String(req.params.applicationId), auth.userId));
  });

  return router;
}
