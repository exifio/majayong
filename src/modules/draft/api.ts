import { DraftEntryType, PrismaClient, Role } from "@prisma/client";
import type { Request, RequestHandler, Response, Router } from "express";
import type { Actor } from "../identity/session.js";
import { errorResponse } from "../../core/observability.js";
import { DraftError } from "./rules.js";
import {
  addDraftBlock, createDraft, deleteDraft, DraftPorts, editDraftChat, getDraft, getRecommendations,
  listDrafts, removeDraftBlock, restoreDraft, retryDraftFeatures, updateConditionNote, updateHopeBudget,
} from "./service.js";

export type AuthenticatedDraftRoute = (handler: (req: Request, res: Response, actor: Actor) => Promise<void>) => RequestHandler;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function body(req: Request, fields: string[]): Record<string, unknown> {
  if (!isRecord(req.body) || Object.keys(req.body).some(key => !fields.includes(key))) throw new DraftError("INVALID_REQUEST", 400);
  return req.body;
}
function stringField(input: Record<string, unknown>, field: string, maxLength: number): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new DraftError("INVALID_REQUEST", 400);
  return value;
}
function draftId(req: Request): string {
  const value = req.params.draftId;
  if (typeof value !== "string" || !value || value.length > 100) throw new DraftError("INVALID_REQUEST", 400);
  return value;
}
function blockId(req: Request): string {
  const value = req.params.blockId;
  if (typeof value !== "string" || !value || value.length > 100) throw new DraftError("INVALID_REQUEST", 400);
  return value;
}
function clientOnly(handler: (req: Request, res: Response, actor: Actor) => Promise<void>) {
  return async (req: Request, res: Response, actor: Actor): Promise<void> => {
    try {
      if (actor.role !== Role.CLIENT) throw new DraftError("ROLE_MISMATCH", 403);
      await handler(req, res, actor);
    } catch (error) {
      if (!(error instanceof DraftError)) throw error;
      const message = error.status >= 500 ? "요청을 처리할 수 없습니다." : "요청을 확인해 주세요.";
      res.status(error.status).json(errorResponse(error.code, message, String(res.locals.requestId ?? "")));
    }
  };
}

export function mountDraftApi(router: Router, db: PrismaClient, ports: DraftPorts, now: () => Date, authenticated: AuthenticatedDraftRoute): void {
  router.post("/drafts", authenticated(clientOnly(async (req, res, actor) => {
    const input = body(req, ["entryType", "text"]);
    if (input.entryType !== DraftEntryType.SENTENCE && input.entryType !== DraftEntryType.DEFAULT_DRAFT) throw new DraftError("INVALID_REQUEST", 400);
    if (input.entryType === DraftEntryType.SENTENCE) {
      const data = await createDraft(db, actor.userId, { entryType: input.entryType, text: stringField(input, "text", 8000) }, ports, now());
      res.status(201).json({ data });
      return;
    }
    if (input.text !== undefined) throw new DraftError("INVALID_REQUEST", 400);
    res.status(201).json({ data: await createDraft(db, actor.userId, { entryType: input.entryType }, ports, now()) });
  })));
  router.get("/drafts", authenticated(clientOnly(async (_req, res, actor) => {
    res.json({ data: await listDrafts(db, actor.userId) });
  })));
  router.get("/drafts/:draftId", authenticated(clientOnly(async (req, res, actor) => {
    res.json({ data: await getDraft(db, draftId(req), actor.userId) });
  })));
  router.delete("/drafts/:draftId", authenticated(clientOnly(async (req, res, actor) => {
    await deleteDraft(db, draftId(req), actor.userId, now());
    res.json({ data: { deleted: true } });
  })));
  router.post("/drafts/:draftId/retry", authenticated(clientOnly(async (req, res, actor) => {
    await retryDraftFeatures(db, draftId(req), actor.userId, ports, now());
    res.json({ data: await getDraft(db, draftId(req), actor.userId) });
  })));
  router.post("/drafts/:draftId/restore", authenticated(clientOnly(async (req, res, actor) => {
    res.json({ data: await restoreDraft(db, draftId(req), actor.userId, now()) });
  })));
  router.post("/drafts/:draftId/messages", authenticated(clientOnly(async (req, res, actor) => {
    const input = body(req, ["text"]);
    res.json({ data: await editDraftChat(db, draftId(req), actor.userId, stringField(input, "text", 8000), ports, now()) });
  })));
  router.get("/drafts/:draftId/recommendations", authenticated(clientOnly(async (req, res, actor) => {
    res.json({ data: await getRecommendations(db, draftId(req), actor.userId, ports, now()) });
  })));
  router.post("/drafts/:draftId/blocks", authenticated(clientOnly(async (req, res, actor) => {
    const input = body(req, ["blockId"]);
    res.json({ data: await addDraftBlock(db, draftId(req), actor.userId, stringField(input, "blockId", 100), now()) });
  })));
  router.delete("/drafts/:draftId/blocks/:blockId", authenticated(clientOnly(async (req, res, actor) => {
    res.json({ data: await removeDraftBlock(db, draftId(req), actor.userId, blockId(req), now()) });
  })));
  router.put("/drafts/:draftId/blocks/:blockId/condition-notes", authenticated(clientOnly(async (req, res, actor) => {
    const input = body(req, ["key", "note"]);
    if (typeof input.note !== "string" || input.note.length > 2000) throw new DraftError("INVALID_REQUEST", 400);
    res.json({ data: await updateConditionNote(db, draftId(req), actor.userId, blockId(req), stringField(input, "key", 100), input.note, now()) });
  })));
  router.patch("/drafts/:draftId/budget", authenticated(clientOnly(async (req, res, actor) => {
    const input = body(req, ["hopeBudget"]);
    const value = input.hopeBudget;
    if (!(value === null || (typeof value === "number" && Number.isSafeInteger(value)))) throw new DraftError("INVALID_REQUEST", 400);
    res.json({ data: await updateHopeBudget(db, draftId(req), actor.userId, value, now()) });
  })));
}
