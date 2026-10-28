import { Role, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import { getRequiredAuth, requireRole } from "../shared/auth.ts";
import { AppError } from "../shared/errors.ts";
import {
  getProjectDetail,
  listProjects,
  listSupplierBookmarks,
  recommendProjects,
  removeProjectBookmark,
  setProjectBookmark,
  type ProjectListInput,
} from "./projects.service.ts";

function queryString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AppError(400, "VALIDATION_ERROR", `${name} 형식이 올바르지 않습니다.`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function queryNumber(value: unknown, name: string): number | undefined {
  const raw = queryString(value, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppError(400, "VALIDATION_ERROR", `${name}은 0 이상의 정수여야 합니다.`);
  }
  return parsed;
}

function queryDate(value: unknown, name: string): Date | undefined {
  const raw = queryString(value, name);
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "VALIDATION_ERROR", `${name} 날짜 형식이 올바르지 않습니다.`);
  }
  return parsed;
}

function parseProjectListQuery(query: Record<string, unknown>): ProjectListInput {
  const rawSort = queryString(query.sort, "sort") ?? "newest";
  if (rawSort !== "newest" && rawSort !== "deadline" && rawSort !== "budget-high") {
    throw new AppError(400, "VALIDATION_ERROR", "정렬 기준이 올바르지 않습니다.");
  }
  const rawStatus = queryString(query.status, "status");
  if (rawStatus !== undefined && rawStatus !== "OPEN" && rawStatus !== "CLOSED") {
    throw new AppError(400, "VALIDATION_ERROR", "모집 상태가 올바르지 않습니다.");
  }
  const minBudget = queryNumber(query.minBudget, "minBudget");
  const maxBudget = queryNumber(query.maxBudget, "maxBudget");
  if (minBudget !== undefined && maxBudget !== undefined && minBudget > maxBudget) {
    throw new AppError(400, "VALIDATION_ERROR", "최소 예산은 최대 예산보다 클 수 없습니다.");
  }
  const deadlineFrom = queryDate(query.deadlineFrom, "deadlineFrom");
  const deadlineTo = queryDate(query.deadlineTo, "deadlineTo");
  if (deadlineFrom !== undefined && deadlineTo !== undefined && deadlineFrom > deadlineTo) {
    throw new AppError(400, "VALIDATION_ERROR", "시작 마감일은 종료 마감일보다 늦을 수 없습니다.");
  }
  const rawSkills = queryString(query.skills, "skills");
  const page = queryNumber(query.page, "page") ?? 1;
  if (page < 1) throw new AppError(400, "VALIDATION_ERROR", "page는 1 이상이어야 합니다.");

  return {
    q: queryString(query.q, "q"),
    industryCode: queryString(query.industryCode, "industryCode"),
    skills: rawSkills?.split(",").map((skill) => skill.trim()).filter(Boolean),
    minBudget,
    maxBudget,
    deadlineFrom,
    deadlineTo,
    status: rawStatus,
    sort: rawSort,
    page,
  };
}

export function createProjectsRouter(prismaClient: PrismaClient): Router {
  const router = Router();

  router.get("/api/projects", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    res.json(await listProjects(prismaClient, auth.userId, parseProjectListQuery(req.query)));
  });

  router.get("/api/projects/:projectId/recommendations", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    res.json(await recommendProjects(prismaClient, String(req.params.projectId), auth.userId));
  });

  router.put("/api/projects/:projectId/bookmark", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    await setProjectBookmark(prismaClient, auth.userId, String(req.params.projectId));
    res.json({ status: "ok" });
  });

  router.delete("/api/projects/:projectId/bookmark", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    await removeProjectBookmark(prismaClient, auth.userId, String(req.params.projectId));
    res.status(204).end();
  });

  router.get("/api/supplier/bookmarks", requireRole(Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    res.json(await listSupplierBookmarks(prismaClient, auth.userId));
  });

  router.get("/api/projects/:projectId", requireRole(Role.CLIENT, Role.SUPPLIER), async (req, res) => {
    const auth = getRequiredAuth(req);
    if (auth.role === Role.ADMIN) throw new AppError(403, "FORBIDDEN", "해당 작업을 수행할 권한이 없습니다.");
    res.json(await getProjectDetail(prismaClient, String(req.params.projectId), {
      userId: auth.userId,
      role: auth.role,
    }));
  });

  return router;
}
