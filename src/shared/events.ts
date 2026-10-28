import { EventType, NotificationType, Prisma } from "@prisma/client";
import type { DbClient, DbTx } from "../db.ts";
import { AppError } from "./errors.ts";

const VALID_EVENT_TYPES = new Set<string>(Object.values(EventType));
const VALID_NOTIFICATION_TYPES = new Set<string>(Object.values(NotificationType));

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 민감 원문·연락처·비밀키가 EventLog payload로 누출되지 않도록 제거
const SENSITIVE_PAYLOAD_KEYS = new Set([
  "content",
  "rawContent",
  "rawText",
  "utterance",
  "phone",
  "email",
  "businessName",
  "password",
  "passwordHash",
  "secretKey",
  "apiKey",
  "accessToken",
  "refreshToken",
]);

function sanitizePayload(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items: Array<Prisma.InputJsonValue | null> = value.map(
      (item: unknown) => sanitizePayload(item) ?? null,
    );
    return items;
  }
  if (isRecord(value)) {
    const cleaned: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_PAYLOAD_KEYS.has(key)) {
        continue;
      }
      const sanitized = sanitizePayload(val);
      cleaned[key] = sanitized === undefined ? null : sanitized;
    }
    return cleaned;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

export interface LogEventInput {
  type: EventType;
  userId?: string | null;
  sessionId?: string | null;
  draftId?: string | null;
  projectId?: string | null;
  payload?: Record<string, unknown> | null;
}

export async function logEvent(db: DbClient, input: LogEventInput) {
  if (!VALID_EVENT_TYPES.has(input.type)) {
    throw new AppError(400, "VALIDATION_ERROR", "허용되지 않은 이벤트 타입입니다.");
  }
  const payload = sanitizePayload(input.payload);
  return db.eventLog.create({
    data: {
      type: input.type,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      draftId: input.draftId ?? null,
      projectId: input.projectId ?? null,
      payload: payload === undefined ? Prisma.DbNull : payload,
    },
  });
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  targetId: string;
  targetUrl: string;
  deduplicateUnread?: boolean;
}

export async function createNotification(tx: DbTx, input: CreateNotificationInput) {
  if (!VALID_NOTIFICATION_TYPES.has(input.type)) {
    throw new AppError(400, "VALIDATION_ERROR", "허용된 알림 6종 범위를 벗어난 타입입니다.");
  }
  if (!input.userId || !input.targetId || !input.targetUrl) {
    throw new AppError(400, "VALIDATION_ERROR", "알림 수신자와 이동 정보가 필요합니다.");
  }
  if (input.deduplicateUnread !== false) {
    const existing = await tx.notification.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        targetId: input.targetId,
        isRead: false,
      },
    });
    if (existing) {
      return existing;
    }
  }
  return tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      targetId: input.targetId,
      targetUrl: input.targetUrl,
    },
  });
}
