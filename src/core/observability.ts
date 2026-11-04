import { randomUUID } from "node:crypto";

const sensitiveLogKey = /(email|phone|name|utterance|content|text|message|body|password|secret|token|account|bank|evidence|amount|price|fee|payment|key)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) =>
      sensitiveLogKey.test(key) ? [] : [[key, sanitize(nested)]]));
  }
  return value;
}

export function createRequestId(): string {
  return randomUUID();
}

export function errorResponse(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}

export function sanitizeLogContext(input: Record<string, unknown>): Record<string, unknown> {
  const cleaned = sanitize(input);
  return isRecord(cleaned) ? cleaned : {};
}

export type LogLevel = "info" | "warn" | "error";
export type Logger = { log(level: LogLevel, event: string, context?: Record<string, unknown>): void };

export function createLogger(write: (line: string) => void = line => process.stdout.write(`${line}\n`)): Logger {
  return {
    log(level, event, context = {}) {
      write(JSON.stringify({ level, event, at: new Date().toISOString(), ...sanitizeLogContext(context) }));
    },
  };
}
