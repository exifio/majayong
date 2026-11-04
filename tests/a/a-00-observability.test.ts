import { describe, expect, it } from "@jest/globals";
import { createRequestId, errorResponse, sanitizeLogContext } from "../../src/core/observability.ts";

describe("A-00 request and log context", () => {
  it("includes the generated request ID in the error envelope", () => {
    const requestId = createRequestId();
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(errorResponse("INTERNAL_ERROR", "요청을 처리할 수 없습니다.", requestId)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "요청을 처리할 수 없습니다.", requestId },
    });
  });

  it("removes sensitive fields recursively before structured logging", () => {
    const sanitized = sanitizeLogContext({
      event: "request_failed",
      requestId: "req-1",
      userEmail: "private@example.invalid",
      clientUtterance: "원문",
      nested: { apiKey: "secret", amount: 1234, status: "failed" },
    });

    expect(sanitized).toEqual({
      event: "request_failed",
      requestId: "req-1",
      nested: { status: "failed" },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/private|원문|secret|1234/);
  });
});
