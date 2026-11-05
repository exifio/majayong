import { PrismaClient, Role } from "@prisma/client";
import type { Request, Router } from "express";
import { errorResponse } from "../../core/observability.js";
import type { AuthenticatedDraftRoute } from "../draft/api.js";
import { DraftError } from "../draft/rules.js";
import { applyEstimateToBudget, getPriceReport } from "./service.js";

function draftId(req: Request): string {
  const value = req.params.draftId;
  if (typeof value !== "string" || value.length === 0 || value.length > 100) throw new DraftError("INVALID_REQUEST", 400);
  return value;
}

export function mountPricingApi(router: Router, db: PrismaClient, now: () => Date, authenticated: AuthenticatedDraftRoute): void {
  router.get("/drafts/:draftId/price-report", authenticated(async (req, res, actor) => {
    try {
      if (actor.role !== Role.CLIENT) throw new DraftError("ROLE_MISMATCH", 403);
      res.json({ data: await getPriceReport(db, draftId(req), actor.userId) });
    } catch (error) {
      if (!(error instanceof DraftError)) throw error;
      res.status(error.status).json(errorResponse(error.code, "요청을 확인해 주세요.", String(res.locals.requestId ?? "")));
    }
  }));

  router.post("/drafts/:draftId/apply-estimate", authenticated(async (req, res, actor) => {
    try {
      if (actor.role !== Role.CLIENT) throw new DraftError("ROLE_MISMATCH", 403);
      res.json({ data: await applyEstimateToBudget(db, draftId(req), actor.userId, now()) });
    } catch (error) {
      if (!(error instanceof DraftError)) throw error;
      res.status(error.status).json(errorResponse(error.code, "요청을 확인해 주세요.", String(res.locals.requestId ?? "")));
    }
  }));
}
