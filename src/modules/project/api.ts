import { PrismaClient, Role } from "@prisma/client";
import type { Request, Router } from "express";
import { errorResponse } from "../../core/observability.js";
import type { AuthenticatedDraftRoute } from "../draft/api.js";
import { DraftError } from "../draft/rules.js";
import { publishDraft, type PublishDraftInput } from "./service.js";

function body(req: Request): Record<string, unknown> {
  const value: unknown = req.body;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DraftError("INVALID_REQUEST", 400);
  const result = value as Record<string, unknown>;
  const allowed = ["recruitStartAt", "deadline", "disclosureConsentVersion", "disclosureScope", "disclosureConsent"];
  if (Object.keys(result).some(key => !allowed.includes(key))) throw new DraftError("INVALID_REQUEST", 400);
  return result;
}

function requiredDate(input: Record<string, unknown>, field: string): Date {
  const value = input[field];
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new DraftError("INVALID_REQUEST", 400);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new DraftError("INVALID_REQUEST", 400);
  return parsed;
}

function parseInput(input: Record<string, unknown>): PublishDraftInput {
  if (typeof input.disclosureConsentVersion !== "string" || !input.disclosureConsentVersion.trim()) {
    throw new DraftError("DISCLOSURE_CONSENT_REQUIRED", 422);
  }
  if (input.disclosureConsent !== true) throw new DraftError("DISCLOSURE_CONSENT_REQUIRED", 422);
  if (input.disclosureScope !== "FULL" && input.disclosureScope !== "DETAIL") throw new DraftError("INVALID_REQUEST", 400);
  return {
    recruitStartAt: input.recruitStartAt === undefined ? undefined : requiredDate(input, "recruitStartAt"),
    deadline: requiredDate(input, "deadline"),
    disclosureConsentVersion: input.disclosureConsentVersion,
    disclosureScope: input.disclosureScope,
    disclosureConsent: true,
  };
}

export function mountProjectApi(
  router: Router,
  db: PrismaClient,
  now: () => Date,
  activeConsentVersion: () => string | null,
  authenticated: AuthenticatedDraftRoute,
): void {
  router.post("/drafts/:draftId/publish", authenticated(async (req, res, actor) => {
    try {
      if (actor.role !== Role.CLIENT) throw new DraftError("ROLE_MISMATCH", 403);
      const draftId = req.params.draftId;
      if (typeof draftId !== "string" || draftId.length === 0 || draftId.length > 100) throw new DraftError("INVALID_REQUEST", 400);
      const project = await publishDraft(db, draftId, actor.userId, parseInput(body(req)), activeConsentVersion(), now());
      res.status(201).json({ data: project });
    } catch (error) {
      if (!(error instanceof DraftError)) throw error;
      res.status(error.status).json(errorResponse(error.code, "요청을 확인해 주세요.", String(res.locals.requestId ?? "")));
    }
  }));
}
