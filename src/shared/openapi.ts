import { Router } from "express";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "마자용 (Majayong) API",
    version: "0.1.0",
    description: "의뢰인 공간과 공급자 공간을 분리한 백엔드 REST API 명세 (M0~M1 기준)",
  },
  tags: [
    { name: "Common", description: "서버 상태 및 공통 엔드포인트" },
    { name: "Supplier Space - Rates", description: "공급자 공간: 본인 블록 단가 등록·조회·수정 (F-04)" },
    { name: "Client Space - Estimates", description: "의뢰인 공간: 블록별 절사평균 예상 단가·수수료 합계 (F-04)" },
    { name: "Projects", description: "프로젝트 탐색·상세·추천·북마크 (F-08, F-17, F-18)" },
    { name: "Applications", description: "견적 제출·비교·수락·거절 (F-05, F-09, F-10)" },
    { name: "Notifications", description: "인앱 알림 (F-11)" },
    { name: "Contracts", description: "계약·납품·검수·구간 지급 상태·상호 리뷰 (F-12~F-14)" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                enum: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR", "CONFLICT", "INTERNAL_ERROR"],
              },
              message: { type: "string" },
            },
          },
        },
      },
      BlockEstimate: {
        type: "object",
        required: ["blockId", "isEstimable", "estUnit", "estMin", "estMax"],
        properties: {
          blockId: { type: "string", format: "uuid" },
          isEstimable: { type: "boolean" },
          estUnit: { type: "integer", nullable: true },
          estMin: { type: "integer", nullable: true },
          estMax: { type: "integer", nullable: true },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Common"],
        summary: "서버 및 DB 연결 상태 확인",
        responses: { "200": { description: "정상 응답" } },
      },
    },
    "/api/supplier/rates": {
      get: {
        tags: ["Supplier Space - Rates"],
        security: [{ BearerAuth: [] }],
        summary: "내 블록 단가 목록 및 등록 완료 여부 조회 (본인 데이터만 반환)",
        responses: {
          "200": { description: "본인 단가 목록" },
          "401": { description: "미인증" },
          "403": { description: "공급자 역할 아님" },
        },
      },
      post: {
        tags: ["Supplier Space - Rates"],
        security: [{ BearerAuth: [] }],
        summary: "블록별 평소 단가 등록 (중복 등록 시 409)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["blockId"],
                properties: {
                  blockId: { type: "string", format: "uuid" },
                  price: { type: "integer", nullable: true },
                  isCapable: { type: "boolean", default: true },
                  isAvgReference: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "등록 성공" },
          "400": { description: "입력 오류" },
          "409": { description: "동일 블록 중복 등록" },
        },
      },
    },
    "/api/supplier/rates/{blockId}": {
      patch: {
        tags: ["Supplier Space - Rates"],
        security: [{ BearerAuth: [] }],
        summary: "등록한 블록 단가 수정",
        parameters: [
          { name: "blockId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "수정 성공" },
          "404": { description: "미등록 블록" },
        },
      },
    },
    "/api/blocks/estimates": {
      get: {
        tags: ["Client Space - Estimates"],
        security: [{ BearerAuth: [] }],
        summary: "복수 블록 절사평균 예상 단가 및 의뢰인 5% 수수료 포함 합계 조회 (공급자 접근 차단)",
        parameters: [
          { name: "blockIds", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "블록별 예상 단가 및 합계" },
          "403": { description: "공급자 접근 차단" },
        },
      },
    },
    "/api/blocks/{blockId}/estimate": {
      get: {
        tags: ["Client Space - Estimates"],
        security: [{ BearerAuth: [] }],
        summary: "단일 블록 절사평균 예상 단가 조회 (공급자 접근 차단)",
        parameters: [
          { name: "blockId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "예상 단가 결과" },
          "403": { description: "공급자 접근 차단" },
        },
      },
    },
    "/api/projects": {
      get: {
        tags: ["Projects"],
        security: [{ BearerAuth: [] }],
        summary: "희망 예산을 포함한 공급자용 프로젝트 목록·필터·정렬·10건 페이지",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "industryCode", in: "query", schema: { type: "string" } },
          { name: "skills", in: "query", schema: { type: "string" } },
          { name: "minBudget", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "maxBudget", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "deadlineFrom", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "deadlineTo", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["OPEN", "CLOSED"] } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["newest", "deadline", "budget-high"] } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
        ],
        responses: { "200": { description: "희망 예산이 포함된 프로젝트 요약(의뢰인 신원·원문 제외)" }, "401": { description: "미인증" }, "403": { description: "공급자 역할 또는 NDA 동의 아님" } },
      },
    },
    "/api/projects/{projectId}": {
      get: {
        tags: ["Projects"],
        security: [{ BearerAuth: [] }],
        summary: "프로젝트 상세 (소유 의뢰인 또는 NDA 동의 공급자)",
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "역할·수락 여부에 맞춘 상세" }, "404": { description: "프로젝트를 찾을 수 없음" } },
      },
    },
    "/api/projects/{projectId}/recommendations": {
      get: {
        tags: ["Projects"],
        security: [{ BearerAuth: [] }],
        summary: "같은 업종·유사 기술 스택의 프로젝트 추천",
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "추천 프로젝트 목록" } },
      },
    },
    "/api/projects/{projectId}/bookmark": {
      put: {
        tags: ["Projects"], security: [{ BearerAuth: [] }], summary: "프로젝트 북마크 추가",
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "북마크 저장 또는 이미 저장됨" } },
      },
      delete: {
        tags: ["Projects"], security: [{ BearerAuth: [] }], summary: "프로젝트 북마크 해제",
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "204": { description: "북마크 해제" } },
      },
    },
    "/api/supplier/bookmarks": {
      get: { tags: ["Projects"], security: [{ BearerAuth: [] }], summary: "내 북마크 목록", responses: { "200": { description: "북마크한 프로젝트 목록" } } },
    },
    "/api/projects/{projectId}/applications": {
      post: {
        tags: ["Applications"], security: [{ BearerAuth: [] }], summary: "프로젝트 항목별 견적 제출 또는 재견적",
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["durationDays", "items"], properties: { durationDays: { type: "integer", minimum: 1 }, items: { type: "array", items: { type: "object", required: ["specItemId", "isAvailable"], properties: { specItemId: { type: "string", format: "uuid" }, isAvailable: { type: "boolean" }, amount: { type: "integer", nullable: true }, memo: { type: "string", nullable: true } } } } } } } } },
        responses: { "201": { description: "견적 제출" }, "400": { description: "입력 오류" }, "409": { description: "열람·모집·명세 상태 충돌" } },
      },
    },
    "/api/projects/{projectId}/applications/compare": {
      get: {
        tags: ["Applications"], security: [{ BearerAuth: [] }], summary: "프로젝트 소유 의뢰인용 최신 유효 견적 비교",
        parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "공급자별 항목·총액·수수료·기간 비교" }, "404": { description: "프로젝트를 찾을 수 없음" } },
      },
    },
    "/api/applications/{applicationId}/accept": {
      post: {
        tags: ["Applications"], security: [{ BearerAuth: [] }], summary: "지원자 수락·다른 제출 자동 거절",
        parameters: [{ name: "applicationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["confirmedExcludedItemIds"], properties: { confirmedExcludedItemIds: { type: "array", items: { type: "string", format: "uuid" } }, firstSentenceExclusionConfirmed: { type: "boolean" } } } } } },
        responses: { "200": { description: "수락 성공" }, "409": { description: "제외 확인·최신 버전·동시 수락 충돌" } },
      },
    },
    "/api/applications/{applicationId}/reject": {
      post: {
        tags: ["Applications"], security: [{ BearerAuth: [] }], summary: "지원서 직접 거절",
        parameters: [{ name: "applicationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "거절 성공" }, "409": { description: "현재 거절할 수 없는 상태" } },
      },
    },
    "/api/notifications": {
      get: { tags: ["Notifications"], security: [{ BearerAuth: [] }], summary: "내 최근 인앱 알림 50건", responses: { "200": { description: "로그인 사용자의 알림" } } },
    },
    "/api/notifications/unread-count": {
      get: { tags: ["Notifications"], security: [{ BearerAuth: [] }], summary: "내 미확인 알림 수", responses: { "200": { description: "미확인 개수" } } },
    },
    "/api/notifications/read-all": {
      post: { tags: ["Notifications"], security: [{ BearerAuth: [] }], summary: "내 미확인 알림 모두 읽음 처리", responses: { "200": { description: "변경한 알림 수" } } },
    },
    "/api/contracts/{applicationId}/signature": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "수락 지원서 계약 서명",
        parameters: [{ name: "applicationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["contentHash"], properties: { contentHash: { type: "string" } } } } } },
        responses: { "200": { description: "서명 상태만 반환" }, "401": { description: "미인증" }, "403": { description: "계약 당사자 아님" }, "409": { description: "이미 서명 또는 계약 상태 충돌" } },
      },
    },
    "/api/contracts/{applicationId}/pdf": {
      get: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "서명된 계약 PDF의 임시 다운로드 주소로 이동",
        parameters: [{ name: "applicationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "302": { description: "5분 private signed URL로 redirect" }, "403": { description: "계약 당사자 아님" }, "409": { description: "양측 서명 전" }, "503": { description: "signed URL 발급 실패" } },
      },
    },
    "/api/contracts/{contractId}/cancellation-requests": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "계약 당사자의 취소 요청 기록",
        parameters: [{ name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string", minLength: 1 }, party: { type: "string", enum: ["CLIENT", "SUPPLIER"] } } } } } },
        responses: { "200": { description: "취소 요청과 CANCELLATION_REQUESTED EventLog 저장" }, "400": { description: "요청 값 오류" }, "401": { description: "미인증" }, "403": { description: "계약 당사자 아님" }, "409": { description: "이미 다른 취소 요청이 있거나 계약 상태 충돌" } },
      },
    },
    "/api/contracts/{contractId}/cancellation": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "운영자가 합의된 취소·환불 상태를 기록",
        parameters: [{ name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["party", "reason"], properties: { party: { type: "string", enum: ["CLIENT", "SUPPLIER", "MUTUAL"] }, reason: { type: "string", minLength: 1 }, negotiatedCompensation: { type: "integer", minimum: 0 }, compensationPercent: { type: "integer", minimum: 50, maximum: 100 } } } } } },
        responses: { "200": { description: "계약 취소·환불·구간·EventLog·지원 거절·모집 복귀를 같은 transaction에 기록" }, "400": { description: "요청 값 오류" }, "401": { description: "미인증" }, "403": { description: "운영자 역할 아님" }, "409": { description: "계약 또는 환불 상태 충돌" } },
      },
    },
    "/api/contracts/{contractId}/deposits": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "의뢰인 계약 예치 시도 생성",
        parameters: [{ name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["idempotencyKey"], properties: { idempotencyKey: { type: "string", minLength: 1 } } } } } },
        responses: { "200": { description: "예치 시도와 Toss orderId 반환 (orderId는 depositId와 동일)" }, "401": { description: "미인증" }, "403": { description: "해당 계약의 의뢰인 아님" }, "409": { description: "계약 또는 예치 상태 충돌" } },
      },
    },
    "/api/contracts/{contractId}/deposits/{depositId}/confirm": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "Toss sandbox 예치 승인 확인",
        parameters: [
          { name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "depositId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["paymentKey", "orderId", "returnedAmount"], properties: { paymentKey: { type: "string" }, orderId: { type: "string", description: "경로의 depositId와 같아야 함" }, returnedAmount: { type: "integer", minimum: 1 } } } } } },
        responses: { "200": { description: "예치 및 콜백 멱등 처리 결과" }, "401": { description: "미인증" }, "403": { description: "해당 계약의 의뢰인 아님" }, "409": { description: "금액·주문 ID·예치 상태 충돌" }, "503": { description: "Toss sandbox 설정 또는 승인 서비스 사용 불가" } },
      },
    },
    "/api/contracts/{contractId}/deposits/{depositId}/operator-review": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "7일 보류 입금 운영자 확인",
        parameters: [
          { name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "depositId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["decision", "reason"], properties: { decision: { type: "string", enum: ["COMPLETE", "FAIL"] }, reason: { type: "string", minLength: 1 } } } } } },
        responses: { "200": { description: "운영자 판단, 예치 상태, EventLog를 같은 transaction에 저장" }, "401": { description: "미인증" }, "403": { description: "운영자 역할 아님" }, "409": { description: "HELD 입금이 아니거나 계약 상태 충돌" } },
      },
    },
    "/api/contracts/{contractId}/reviews": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "완료 계약의 당사자 리뷰 등록 (작성자별 1회)",
        parameters: [{ name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["rating"], properties: { rating: { type: "integer", minimum: 1, maximum: 5 }, comment: { type: "string", nullable: true }, tags: { type: "array", items: { type: "string" }, default: [] } } } } } },
        responses: { "200": { description: "리뷰와 갱신된 상대 평점 캐시" }, "401": { description: "미인증" }, "403": { description: "완료 계약 당사자 아님" }, "409": { description: "미완료 계약 또는 중복 리뷰" } },
      },
    },
    "/api/contracts/{contractId}/installments/{installmentId}/deliveries": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "공급자 구간 납품 제출",
        parameters: [
          { name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "installmentId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { summary: { type: "string", nullable: true }, fileUrl: { type: "string", nullable: true } } } } } },
        responses: { "201": { description: "납품 회차와 구간 상태 저장" }, "401": { description: "미인증" }, "403": { description: "해당 계약의 공급자 아님" }, "409": { description: "예치 또는 구간 상태 불일치" } },
      },
    },
    "/api/contracts/{contractId}/deliveries/{deliveryId}/inspection": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "납품을 승인하거나 계약 범위 안의 보완 요청 등록",
        parameters: [
          { name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "deliveryId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["requests"], properties: { requests: { type: "array", items: { type: "object", required: ["applicationItemId", "reason"], properties: { applicationItemId: { type: "string", format: "uuid" }, reason: { type: "string", enum: ["IN_SPEC", "NOT_IN_SPEC", "INTERPRETATION"] }, note: { type: "string", nullable: true } } } } } } } } },
        responses: { "200": { description: "납품·구간 및 보완 요청 상태 저장" }, "401": { description: "미인증" }, "403": { description: "해당 계약의 의뢰인 아님" }, "409": { description: "최신 납품이 아니거나 검수할 수 없는 상태" } },
      },
    },
    "/api/contracts/{contractId}/installments/{installmentId}/release": {
      post: {
        tags: ["Contracts"], security: [{ BearerAuth: [] }], summary: "승인 구간의 지급 완료 상태 기록 (외부 송금 호출 없음)",
        parameters: [
          { name: "contractId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "installmentId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "구간·계약 지급 상태 저장" }, "401": { description: "미인증" }, "403": { description: "운영자 역할 아님" }, "409": { description: "구간 미승인 또는 지급 순서 오류" } },
      },
    },
  },
} as const;

export function createOpenApiRouter(): Router {
  const router = Router();

  router.get("/api-docs.json", (_req, res) => {
    res.json(openApiSpec);
  });

  router.get("/api-docs", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>마자용 API 문서</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: "/api-docs.json", dom_id: "#swagger-ui" });
  </script>
</body>
</html>`);
  });

  return router;
}
