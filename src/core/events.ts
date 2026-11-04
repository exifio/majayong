import { EventType, type Prisma } from "@prisma/client";

export class EventError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
  }
}

export type LlmPurpose =
  | "BLOCK_CLASSIFY"
  | "BLOCK_CREATE"
  | "DRAFT_CHAT"
  | "AGREEMENT_SUMMARY"
  | "CONDITION_TAGS"
  | "PORTFOLIO_SUMMARY";

export const LLM_PURPOSES: readonly LlmPurpose[] = [
  "BLOCK_CLASSIFY",
  "BLOCK_CREATE",
  "DRAFT_CHAT",
  "AGREEMENT_SUMMARY",
  "CONDITION_TAGS",
  "PORTFOLIO_SUMMARY",
];

export type EventInput = {
  type: EventType;
  userId?: string | null;
  sessionId?: string | null;
  draftId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: Date;
};

export type LlmCallInput = {
  userId?: string | null;
  purpose: LlmPurpose;
  model: string;
  tokens: { input: number; output: number };
  costKrw: number;
  latencyMs: number;
  succeeded: boolean;
  reserved?: boolean;
  draftId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  occurredAt?: Date;
};

const rawTextKey = /(utterance|content|text|message|body|email|phone|contact|address|account|bank|evidence|password|secret|note)/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonSafe(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new EventError("INVALID_EVENT_PAYLOAD");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonSafe(item);
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (rawTextKey.test(key)) throw new EventError("UNSAFE_EVENT_PAYLOAD");
      assertJsonSafe(nested);
    }
    return;
  }
  throw new EventError("INVALID_EVENT_PAYLOAD");
}

function assertSafePayload(payload: Record<string, unknown>): Prisma.InputJsonObject {
  assertJsonSafe(payload);
  return payload as Prisma.InputJsonObject;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new EventError("INVALID_LLM_METRIC");
  return value;
}

export async function recordEvent(tx: Prisma.TransactionClient, input: EventInput): Promise<{ id: string }> {
  if (!(input.type in EventType)) throw new EventError("INVALID_EVENT_TYPE");
  const occurredAt = input.occurredAt ?? new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new EventError("INVALID_EVENT_TIME");
  const payload = input.payload == null ? undefined : assertSafePayload(input.payload);
  return tx.eventLog.create({
    data: {
      type: input.type,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      draftId: input.draftId ?? null,
      projectId: input.projectId ?? null,
      contractId: input.contractId ?? null,
      ...(payload === undefined ? {} : { payload }),
      occurredAt,
    },
    select: { id: true },
  });
}

export async function recordLlmCall(tx: Prisma.TransactionClient, input: LlmCallInput): Promise<{ id: string }> {
  if (!LLM_PURPOSES.includes(input.purpose)) throw new EventError("INVALID_LLM_PURPOSE");
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model || model.length > 100) throw new EventError("INVALID_LLM_MODEL");
  const inputTokens = nonNegativeInteger(input.tokens?.input);
  const outputTokens = nonNegativeInteger(input.tokens?.output);
  const costKrw = nonNegativeInteger(input.costKrw);
  const latencyMs = nonNegativeInteger(input.latencyMs);

  return recordEvent(tx, {
    type: EventType.LLM_CALLED,
    userId: input.userId,
    draftId: input.draftId,
    projectId: input.projectId,
    contractId: input.contractId,
    occurredAt: input.occurredAt,
    payload: {
      purpose: input.purpose,
      model,
      tokens: { input: inputTokens, output: outputTokens },
      costKrw,
      latencyMs,
      succeeded: input.succeeded === true,
      ...(input.reserved ? { reserved: true } : {}),
    },
  });
}
