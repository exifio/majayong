import { describe, expect, it } from "@jest/globals";
import { sanitizeLogContext } from "../../src/core/observability.ts";

// Mirrors v0.6.1 src/shared/events.ts SENSITIVE_PAYLOAD_KEYS. Every key v0.6.1 masked
// must still be masked by the v0.7 log sanitizer, otherwise PII can regress into logs.
const legacySensitiveKeys = [
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
];

describe("A-00 v0.6.1 -> v0.7 security baseline", () => {
  it("masks every key v0.6.1 treated as sensitive, including nested objects", () => {
    const nested: Record<string, unknown> = {};
    for (const key of legacySensitiveKeys) nested[key] = "secret-value";
    const sanitized = sanitizeLogContext({ event: "kept", requestId: "kept", nested });
    const text = JSON.stringify(sanitized);

    for (const key of legacySensitiveKeys) expect(text).not.toContain(key);
    expect(text).not.toContain("secret-value");
    expect(text).toContain("kept");
  });

  it("keeps non-sensitive diagnostics for observability", () => {
    const sanitized = sanitizeLogContext({ event: "request_failed", requestId: "req-1", status: "failed", latencyMs: 42 });
    const text = JSON.stringify(sanitized);

    expect(text).toContain("request_failed");
    expect(text).toContain("req-1");
    expect(text).toContain("failed");
    expect(text).toContain("42");
  });
});
