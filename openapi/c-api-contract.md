# C API HTTP 계약 (D-21 A안, 2026-11-05)

사용자용 C API는 A/B와 같은 공통 HTTP 봉투를 사용한다. C 서비스 내부 DTO와 비즈니스 로직은 그대로이며, `src/c-app.ts` HTTP 경계에서만 정규화한다.

## 공통 봉투

성공:

```json
{ "data": { } }
```

목록 성공:

```json
{ "data": [ ] }
```

오류:

```json
{ "error": { "code": "FORBIDDEN", "message": "계약 당사자만 조회할 수 있습니다.", "requestId": "..." } }
```

- 모든 사용자용 C 응답은 `x-request-id` 헤더를 포함한다. 요청에 없으면 서버가 생성한다.
- 성공 상태 코드는 기존과 동일하게 `200`/`201`을 유지한다.
- 오류 상태 코드와 업무 의미는 기존과 동일하다. 500은 내부 예외 메시지를 노출하지 않고 `요청을 처리할 수 없습니다.`로 응답한다.
- C 서비스 오류에 `code`가 있으면 그 값을, 없으면 상태 코드 기반 기본 코드를 쓴다.

## 기본 오류 코드

| status | code |
|---|---|
| 400 | `INVALID_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `UNPROCESSABLE_ENTITY` |
| 503 | `SERVICE_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` |

예치 요청은 다음 세부 코드를 사용한다: `CLIENT_ONLY`, `CONTRACT_NOT_FOUND`, `CONTRACT_NOT_DEPOSITABLE`, `DEPOSIT_DEADLINE_EXPIRED`, `AMOUNT_MISMATCH`, `IDEMPOTENCY_KEY_REUSED`, `DEPOSIT_ALREADY_COMPLETED`, `FORBIDDEN`, `WEBHOOK_FORBIDDEN`, `WEBHOOK_AUTH_FAILED`, `INVALID_WEBHOOK_PAYLOAD`.

## 사용자용 C routes

| Method | Path | 성공 | 성공 DTO |
|---|---|---|---|
| POST | `/contracts/{contractId}/deposits` | 201 | `{ deposit: EscrowDeposit, isNew: boolean }` |
| GET | `/contracts/{contractId}/deposits` | 200 | `EscrowDeposit[]` |
| GET | `/me/payment-statements` | 200 | `{ simulated, transferNote, statements }` |
| GET | `/contracts/{contractId}/statement` | 200 | `ClientStatementView \| SupplierStatementView` |
| GET | `/contracts/{contractId}/installments` | 200 | `PaymentInstallment[]` |
| POST | `/installments/{installmentId}/tax-invoice-issued` | 200 | 세금계산서 발행 결과 |
| POST | `/installments/{installmentId}/deliveries` | 201 | `DeliveryEntity` |
| GET | `/installments/{installmentId}/deliveries` | 200 | `DeliveryEntity[]` |
| GET | `/deliveries/{deliveryId}` | 200 | `DeliveryEntity` |
| POST | `/contract-items/{contractItemId}/approve` | 200 | 승인 결과 |
| POST | `/contract-items/{contractItemId}/rework-requests` | 201 | 보완 요청 |
| GET | `/contract-items/{contractItemId}/rework-requests` | 200 | 보완 요청 목록 |
| POST | `/inspection-requests/{inspectionRequestId}/escalate` | 200 | 검수 이의 |
| POST | `/contracts/{contractId}/cancellation` | 201 | `CancellationRecord` |
| GET | `/contracts/{contractId}/cancellation` | 200 | `CancellationRecord` |
| POST | `/contracts/{contractId}/cancellation/agree` | 200 | `CancellationRecord` |
| POST | `/contracts/{contractId}/cancellation/object` | 200 | `CancellationRecord` |
| POST | `/contracts/{contractId}/reviews` | 201 | `ReviewEntity` |
| GET | `/contracts/{contractId}/reviews` | 200 | `PublicReviewDto[]` |
| GET | `/profiles/suppliers/{supplierId}/reviews` | 200 | `PublicReviewDto[]` |
| GET | `/projects/{projectId}/client-reviews` | 200 | `PublicReviewDto[]` |
| POST | `/uploads/presign` | 201 | 업로드 URL |
| GET | `/uploads/{fileId}/download` | 200 | 다운로드 URL |
| GET | `/admin/blocks` | 200 | `AdminBlock[]` |
| POST | `/admin/blocks/{blockId}/actions` | 200 | 블록 action 결과 |
| GET | `/admin/deposits/held` | 200 | `AdminHeldDeposit[]` |
| POST | `/admin/deposits/{depositId}/resolve` | 200 | 예치 판정 결과 |
| GET | `/admin/inspection-requests/escalated` | 200 | `AdminEscalatedInspection[]` |
| POST | `/admin/inspection-requests/{inspectionRequestId}/decision` | 200 | 검수 판정 결과 |
| GET | `/admin/contracts/cancellation-queue` | 200 | `AdminCancellationContract[]` |
| POST | `/admin/contracts/{contractId}/cancellation/decide` | 200 | 취소 판정 결과 |
| POST | `/admin/contracts/{contractId}/settlement/mark-processed` | 200 | 정산 처리 결과 |
| GET | `/admin/event-logs` | 200 | `EventLogEntity[]` |

## Webhook 예외

`POST /integrations/toss/payment-events`는 외부 PG 프로토콜이므로 공통 봉투를 적용하지 않는다. 기존처럼 서비스 결과 body와 status를 그대로 반환하고, 인증은 `x-toss-webhook-secret` 서버 비밀키로 검증한다. 비밀키가 없거나 일치하지 않으면 401이다.

## 예치 상태

`EscrowDeposit.status`: `PENDING | HELD | COMPLETED | FAILED`(스키마 enum 기준). `POST /contracts/{id}/deposits`의 201은 **결제 요청 생성**이며 완료가 아니다. 실제 완료는 검증된 PG 콜백/재조회 후 `COMPLETED`로 바뀌고, 그 시점에 계약 `paymentStatus`/`totalDeposited`와 다른 보류 지원자 자동 거절이 갱신된다.
