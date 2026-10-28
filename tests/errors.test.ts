import { Prisma } from "@prisma/client";
import { Router } from "express";
import { describe, expect, it } from "@jest/globals";
import { createApp } from "../src/app.ts";
import { mapTradeError } from "../src/shared/errors.ts";
import { assertRecord, getServerPort } from "./helpers.ts";

describe("공통 오류 응답 매핑", () => {
  it("Prisma 오류를 공개 API 오류로 변환하고 알 수 없는 오류 상세를 숨긴다", async () => {
    const errors = new Map<string, Error>([
      [
        "p2002",
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
        }),
      ],
      [
        "p2025",
        new Prisma.PrismaClientKnownRequestError("missing", {
          code: "P2025",
          clientVersion: "test",
        }),
      ],
      [
        "p2003",
        new Prisma.PrismaClientKnownRequestError("invalid reference", {
          code: "P2003",
          clientVersion: "test",
        }),
      ],
      [
        "check-constraint",
        new Prisma.PrismaClientUnknownRequestError("23514 check constraint", {
          clientVersion: "test",
        }),
      ],
      ["unknown", new Error("private internal detail")],
    ]);
    const router = Router();
    router.get("/test/errors/:kind", (req, _res, next) => {
      next(errors.get(req.params.kind) ?? new Error("unexpected error case"));
    });

    const server = createApp({ extraRouters: [router] }).listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));

    try {
      const baseUrl = `http://127.0.0.1:${getServerPort(server)}`;
      const cases = [
        { kind: "p2002", status: 409, code: "CONFLICT" },
        { kind: "p2025", status: 404, code: "NOT_FOUND" },
        { kind: "p2003", status: 400, code: "VALIDATION_ERROR" },
        { kind: "check-constraint", status: 400, code: "VALIDATION_ERROR" },
        { kind: "unknown", status: 500, code: "INTERNAL_ERROR" },
      ];

      for (const expected of cases) {
        const response = await fetch(`${baseUrl}/test/errors/${expected.kind}`);
        expect(response.status).toBe(expected.status);
        const body = assertRecord(await response.json());
        const error = assertRecord(body.error);
        expect(error.code).toBe(expected.code);
        if (expected.kind === "unknown") {
          expect(error.message).not.toContain("private internal detail");
        }
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each(["CONTRACT_PDF_UPLOAD_FAILED", "CONTRACT_PDF_URL_FAILED"])(
    "%s 를 서비스 일시 중단 503으로 매핑한다",
    (code) => {
      const mapped = mapTradeError({ code });

      expect(mapped.statusCode).toBe(503);
      expect(mapped.code).toBe("INTERNAL_ERROR");
      expect(mapped.message).not.toContain(code);
    },
  );

  it.each(["TOSS_CONFIRM_UNAVAILABLE", "TOSS_CONFIRM_INVALID_RESPONSE", "TOSS_TEST_KEY_REQUIRED"])(
    "%s 는 계약서 문구가 아닌 결제 전용 503 문구로 매핑한다",
    (code) => {
      const mapped = mapTradeError({ code });

      expect(mapped.statusCode).toBe(503);
      expect(mapped.message).toContain("결제");
      expect(mapped.message).not.toContain("계약서");
    },
  );
});
