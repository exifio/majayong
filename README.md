# 마자용 백엔드

처음 외주를 맡기는 사람이 화면 초안을 고치며 기능과 예산을 정리하는 서비스입니다.
**초안 → 명세 확정 → 항목별 견적 → 계약·검수**로 이어집니다.
첫 업종은 예약기반음식점이며, 결제는 Toss sandbox만 사용합니다.

## 현재 상태

2026-10-28 기준, `back`의 `4bf9ac5`에 A/B 최신 커밋(코드 저장 기록)이 합쳐져 있습니다.

- 서버·DB, 단가, 탐색·견적·수락, 계약·PDF, 결제·검수·리뷰 코드가 있습니다.
- **실제 로그인 연결과 배포 환경 전체 흐름은 아직 완료되지 않았습니다.**
- 취소 보상은 B의 기록과 통합 코드가 다릅니다. [금액 예시](docs/CANCELLATION.md)를 확인합니다.
- 코드 존재, 과거 시험, 현재 검증을 구분합니다. 근거는 [검증 기록](docs/VERIFICATION.md)에 있습니다.

## 어떤 문서를 읽나요?

처음에는 이 파일과 본인 TASKS만 읽고, 필요한 주제만 찾아봅니다.

| 알고 싶은 내용 | 문서 |
|---|---|
| A / B의 지금·다음 작업 | [TASKS_A](docs/TASKS_A.md) / [TASKS_B](docs/TASKS_B.md) |
| 전체 목표와 남은 순서 | [PRD](docs/PRD.md) / [PLAN](docs/PLAN.md) |
| 코드·DB 구조 | [DESIGN](docs/DESIGN.md) |
| 초안·명세·가격 | [DRAFT](docs/DRAFT.md) |
| 탐색·견적·수락·알림 | [MARKET](docs/MARKET.md) |
| 계약·결제·검수·리뷰 | [TRADE](docs/TRADE.md) |
| 취소 보상 차이 | [CANCELLATION](docs/CANCELLATION.md) |
| 화면의 색·글자 | [UI](docs/UI.md) |
| 무엇을 어떻게 확인했는지 | [VERIFICATION](docs/VERIFICATION.md) |
| 개발 규칙 | [AGENTS](AGENTS.md) |

## 실행 방법

Node.js v26.9.0 사용 기록이 있습니다. 설치 버전은 `package-lock.json`을 기준으로 합니다.

1. `npm ci`로 의존성을 설치합니다.
2. `.env.example`을 `.env`로 복사하고 값을 설정합니다.
3. `npm run db:generate`로 DB 접근 코드를 만듭니다.
4. 연결할 DB를 확인한 뒤 `npm run db:migrate`로 변경 이력을 적용합니다.
5. `npm run dev`로 서버를 실행합니다.

| 명령 | 하는 일 |
|---|---|
| `npm run typecheck` / `npm run build` | 타입 검사 / 실행 파일 생성 |
| `npm run db:validate` | DB 설계 파일 형식 검사 |
| `npm test` | Jest 시험. **데이터를 비워도 되는 전용 테스트 DB에서만 실행** |
| `npm run start` | 빌드한 서버 실행 |

기본 주소는 `http://localhost:3000`입니다.
서버 확인은 `/health`, API 설명서는 `/api-docs`, 원본 명세는 `/api-docs.json`입니다.
`npm run lint` 명령은 현재 없습니다.

## 환경 설정과 주의점

- DB: `DATABASE_URL`. 전체 테스트는 이 주소의 데이터를 지우는 경우가 있습니다.
- PDF 보관: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_CONTRACT_BUCKET`(기본 `contracts`).
- 결제: 서버는 `TOSS_TEST_SECRET_KEY`를 사용합니다. 실제 결제·송금·PG 환불은 범위 밖입니다.
- 인증: production(배포용 실행)의 `AuthVerifier`(로그인 확인 함수) 연결이 빠져 보호 API는 401입니다.
- `ALLOW_HEADER_AUTH`는 로컬 시험용이며 production에서는 사용할 수 없습니다.

`AGENTS.md`와 `docs/`는 로컬 전용이고 작업 폴더끼리 자동 공유되지 않습니다.
현재 `.gitignore`의 문서 제외 규칙은 주석 상태입니다. 커밋 전 포함 파일을 확인합니다.
비밀 키나 `.env`는 올리지 않습니다.
