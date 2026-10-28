import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function mapTradeError(error: { readonly code: string }): AppError {
  switch (error.code) {
    case "UNAUTHORIZED":
      return new AppError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
    case "CONTRACT_SIGNING_FORBIDDEN":
    case "DELIVERY_SUBMISSION_FORBIDDEN":
    case "INSPECTION_FORBIDDEN":
    case "INSPECTION_ESCALATION_FORBIDDEN":
    case "PAYOUT_FORBIDDEN":
    case "REFUND_FORBIDDEN":
    case "REVIEW_FORBIDDEN":
    case "DEPOSIT_FORBIDDEN":
    case "OPERATOR_REVIEW_FORBIDDEN":
    case "CANCELLATION_FORBIDDEN":
    case "MUTUAL_CANCELLATION_REQUIRES_ADMIN":
      return new AppError(403, "FORBIDDEN", "해당 작업을 수행할 권한이 없습니다.");
    case "CONTRACT_NOT_FOUND":
    case "DELIVERY_NOT_FOUND":
    case "INSTALLMENT_NOT_FOUND":
    case "REVIEW_PROFILE_NOT_FOUND":
    case "DEPOSIT_NOT_FOUND":
      return new AppError(404, "NOT_FOUND", "요청한 대상을 찾을 수 없습니다.");
    case "APPLICATION_ID_REQUIRED":
    case "CONTRACT_ID_REQUIRED":
    case "DELIVERY_ID_REQUIRED":
    case "INSTALLMENT_ID_REQUIRED":
    case "DEPOSIT_ID_REQUIRED":
    case "INVALID_CONTENT_HASH":
    case "INVALID_CONTRACT_ID":
    case "IDEMPOTENCY_KEY_REQUIRED":
    case "INVALID_CALLBACK":
    case "INVALID_DEPOSIT_CONFIRMATION_BODY":
    case "INVALID_OPERATOR_REVIEW_BODY":
    case "INVALID_OPERATOR_REVIEW_DECISION":
    case "PAYMENT_ORDER_ID_REQUIRED":
    case "TOSS_PAYMENT_KEY_INVALID":
    case "TOSS_ORDER_ID_INVALID":
    case "TOSS_IDEMPOTENCY_KEY_INVALID":
    case "TOSS_AMOUNT_MISMATCH":
    case "OPERATOR_REVIEW_REASON_REQUIRED":
    case "INVALID_AMOUNT":
    case "INVALID_FEE":
    case "INVALID_RELEASE_AMOUNT":
    case "INVALID_COUPON_TIME":
    case "INVALID_DURATION_DAYS":
    case "INVALID_INSTALLMENT_STAGE_ASSIGNMENT":
    case "INVALID_CANCELLATION_TIME":
    case "INVALID_CANCELLATION_STATE":
    case "INVALID_REFUND_TIME":
    case "INVALID_COMPENSATION_PERCENT":
    case "INVALID_COMPENSATION_AMOUNT":
    case "COMPENSATION_BELOW_MINIMUM":
    case "COMPENSATION_EXCEEDS_AVAILABLE":
    case "NEGOTIATED_COMPENSATION_REQUIRED":
    case "INVALID_RATIO":
    case "AMOUNT_TOO_SMALL":
    case "DELIVERY_ATTEMPT_INVALID":
    case "DUPLICATE_INSPECTION_ID":
    case "DUPLICATE_INSPECTION_ITEM":
    case "INSPECTION_ITEM_OUT_OF_SCOPE":
    case "INVALID_CONTRACT_SCOPE":
    case "INVALID_DELIVERY_BODY":
    case "INVALID_DELIVERY_FILE_URL":
    case "INVALID_DELIVERY_SCOPE":
    case "INVALID_DELIVERY_SUMMARY":
    case "INVALID_INSPECTION_BODY":
    case "INVALID_INSPECTION_ITEM":
    case "INVALID_INSPECTION_NOTE":
    case "INVALID_INSPECTION_REASON":
    case "INVALID_CANCELLATION_BODY":
    case "INVALID_CANCELLATION_PARTY":
    case "CANCELLATION_REASON_REQUIRED":
    case "CANCELLATION_PARTY_REQUIRED":
    case "INVALID_REVIEW_BODY":
    case "INVALID_REVIEW_COMMENT":
    case "INVALID_REVIEW_RATING":
    case "INVALID_REVIEW_TAGS":
    case "REFUND_REASON_REQUIRED":
    case "INVALID_CLIENT_FEE_REFUND":
      return new AppError(400, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.");
    case "CONTRACT_NOT_PENDING":
    case "ALREADY_SIGNED":
    case "CONTRACT_CONTENT_MISMATCH":
    case "APPLICATION_NOT_ACCEPTED":
    case "SPEC_VERSION_MISMATCH":
    case "FOREIGN_APPLICATION_ITEM":
    case "EMPTY_SCOPE":
    case "CONTRACT_PDF_NOT_READY":
    case "CONTRACT_NOT_SIGNED":
    case "CONTRACT_NOT_ACTIVE":
    case "CANCELLATION_ALREADY_REQUESTED":
    case "CONTRACT_ALREADY_EXISTS":
    case "DEPOSIT_NOT_HELD":
    case "PAYMENT_ORDER_ID_MISMATCH":
    case "TOSS_CONFIRM_MISMATCH":
    case "TOSS_CONFIRM_REJECTED":
    case "COUPON_NOT_OWNED":
    case "DEPOSIT_ALREADY_OPEN":
    case "CONTRACT_NOT_COMPLETED":
    case "CONTRACT_NOT_CANCELLED":
    case "DELIVERY_INSTALLMENT_MISMATCH":
    case "DELIVERY_NOT_REVIEWABLE":
    case "DEPOSIT_NOT_COMPLETE":
    case "INSTALLMENT_NOT_APPROVED":
    case "INSTALLMENT_NOT_DELIVERABLE":
    case "INSPECTION_NOT_OPEN":
    case "INTERIM_RELEASE_REQUIRED":
    case "INVALID_INTERIM_RELEASE_STATE":
    case "REFUND_ALREADY_RECORDED":
    case "REFUND_AMOUNT_MISMATCH":
    case "REFUND_NOT_AVAILABLE":
    case "REVIEW_ALREADY_SUBMITTED":
    case "STALE_DELIVERY":
      return new AppError(409, "CONFLICT", "현재 상태에서는 요청을 처리할 수 없습니다.");
    case "CONTRACT_PDF_UPLOAD_FAILED":
    case "CONTRACT_PDF_URL_FAILED":
    case "TOSS_TEST_KEY_REQUIRED":
    case "TOSS_CONFIRM_UNAVAILABLE":
    case "TOSS_CONFIRM_INVALID_RESPONSE":
      return new AppError(503, "INTERNAL_ERROR", "계약서 파일 서비스를 일시적으로 사용할 수 없습니다.");
    case "INVALID_CONTRACT_PDF":
    case "INVALID_SIGNATURE_TIME":
    default:
      return new AppError(500, "INTERNAL_ERROR", "서버 내부 오류가 발생했습니다.");
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "요청 JSON 형식이 올바르지 않습니다." },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({
        error: { code: "CONFLICT", message: "이미 존재하는 데이터입니다." },
      });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "요청한 대상을 찾을 수 없습니다." },
      });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "참조 대상 데이터가 유효하지 않습니다." },
      });
      return;
    }
  }

  if (err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes("23514")) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "데이터 무결성 제약 조건을 위반했습니다." },
    });
    return;
  }

  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다." },
  });
};
