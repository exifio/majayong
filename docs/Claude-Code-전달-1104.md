# 11/04 변경 — Claude Code 전달

오늘(11/04) 화면 설계 캔버스에서 바꾼 것 전부를 Claude Code가 리포지토리에 반영하도록 한 문서로 묶었다. **이 문서가 입구**이고, 세부 규격은 아래 문서에 있다.

| 문서(`docs/`) | 무엇 | 언제 읽나 |
|---|---|---|
| `Claude-Code-전달-1104.md` | 이 문서 — 전체 목록 · 보드별 할 일 · 붙여 넣을 지시 | 맨 먼저 |
| `변경사항-1104.md` | A~K — 새 화면 2개(1:1 문의), 고객센터 · 약관 · 랜딩 개편, 알림 · 메뉴 · 푸터 | 공통 작업 · 해당 보드 |
| `디자인-보완-1104.md` | Part 1 빠진 디자인 4건 · **Part 1-B 확정 버튼 뒤 상태 6건** · **Part 1-C 푸터** · Part 2 디자인 없이 처리할 7건 | 해당 보드 |
| `결정메모-프론트엔드-착수-기준.md` | 결정 #1~#23(11/04 결정 #12~#23) | 판단이 갈릴 때 |
| `디자인-시스템-v0.2.1-최종본.md` | 규격(푸터 · 랜딩 · 칩 · 운영자 메뉴 갱신) | 늘 |
| `PRD-v0.7-최종본.md` · `프론트엔드-개발-준비.md` | 정책 · 경로 | 늘 |
| `boards/*.dc.html` | **보드 57개 최신본**(+ `_discarded/` 4) — 마크업 · `<style>` · `data-props`(상태) · `renderVals`(상태별 값) | 보드 구현 때 원본 |

**변하지 않는 것** — 스키마 · ERD · 이벤트 종류(이미 있는 `EventType` · `DisputeDecision` · `ReportAction`만 쓴다). 토큰은 `--footer-height` 하나만(393 → 256).

---

## 1. 오늘 바뀐 것 한눈에

| # | 무엇 | 보드 | 상세 |
|---|---|---|---|
| 1 | **운영자 1:1 문의 화면 신설** `/admin/inquiries` | `Admin-Inquiries`(새) | 변경사항 A |
| 2 | **1:1 문의를 별도 화면으로** `/help/inquiry`(문의하기 · 내 문의) | `Help-Inquiry`(새) | 변경사항 B |
| 3 | 고객센터는 FAQ · 공지만, FAQ 8 → 14, **공지는 펼침 목록** | `Help` | 변경사항 C · 보완 1-4 |
| 4 | 약관 · 정책을 공통 화면으로(셸 viewer) | `Terms` | 변경사항 D |
| 5 | **비로그인 랜딩 2종 개편**(3장면 애니메이션 · 가치 카드 · 흐름도) | `Main` · `Supplier-Landing` | 변경사항 E |
| 6 | 알림 '1:1 문의에 답변이 왔습니다' | 알림 드롭다운 | 변경사항 F |
| 7 | 운영자 사이드 메뉴 '1:1 문의'(신고 처리 아래) | 운영자 셸 | 변경사항 G |
| 8 | **푸터 새 디자인**(navy-900 · 3줄 · 높이 256) + 푸터 '1:1 문의' → `/help/inquiry` | 공통 푸터 | 변경사항 H · K, 보완 1-C |
| 9 | 랜딩 2종 마지막 띠 navy-700(푸터와 구분) | `Main` · `Supplier-Landing` | 보완 1-C |
| 10 | 증빙 정보 바꾸기 모달 · 오류 · 저장 완료 | `Account-Client` | 보완 1-1 |
| 11 | 정산 계좌 1원 인증 다음 단계 | `Account-Supplier` | 보완 1-2 |
| 12 | 취소 요청 철회(철회 시점 · 기한 연장 확정 — 결정 #19 · #20) | `Cancel-Client` · `Cancel-Supplier` · `Contracts-Client` | 보완 1-3 |
| 13 | 운영자 블록 — 병합 · 단가 수정 · 비활성화 **뒤** | `Admin-Blocks` | 보완 1-5 |
| 14 | 신고 조치 — 문제 없음 · 채팅 7일 제한 선택 · 조치별 완료 | `Admin-Reports` | 보완 1-6 |
| 15 | 이견 판정 — 선택지별 작성 · 완료 | `Admin-Disputes` | 보완 1-7 |
| 16 | 검수 — 보완 요청 · 도움 요청 **보낸 뒤** | `Inspect-Client` | 보완 1-8 |
| 17 | 납품 — 운영자에게 도움 요청 모달 · 보낸 뒤 | `Deliver-Supplier` | 보완 1-9 |
| 18 | 지원 철회 · 서명 거절 · 임시 계약 취소 · 제안 거절 **확정 뒤** | `Apps-Supplier` · `Contract-Supplier` · `Contract-Client` · `Compare-Client` | 보완 1-10 |
| 19 | 새 화면 없이 연결만 하는 7건(알림 페이지 없음 · FAQ 분류 · 납품물 펼침 · 블록 상세/탭 · 결제 재조회 · PDF/증빙 파일) | 여러 보드 | 보완 Part 2 |
| 20 | 화면 수 55 → **57**, 보드 61(사용 57 · 폐기 4) | — | 변경사항 I · J |

---

## 2. 보드별 할 일

`?mock=` 상태 이름은 **보드 Tweak 이름 그대로**(routes.ts `states`에 더한다). 굵은 것이 오늘 생긴 상태.

| 보드 | 경로 | 상태(`?mock=`) | 근거 |
|---|---|---|---|
| `Help-Inquiry` **새** | `/help/inquiry` | **문의 작성 · 문의 보냄 · 내 문의**(× 의뢰인 · 공급자 · 비로그인 — DEV 세션 패널로) | 변경 B |
| `Admin-Inquiries` **새** | `/admin/inquiries` | **답변 대기 · 답변 작성 · 답변 보냄 · 답변 완료 탭** | 변경 A |
| `Help` | `/help` | 자주 묻는 질문 · 검색 결과 · **공지 펼침 · 공지사항** (1:1 문의 상태는 빠짐) | 변경 C · 보완 1-4 |
| `Terms` | `/terms/:doc` | 그대로(문서 4종) — 셸만 public → viewer | 변경 D |
| `Main` | `/` | **자동 재생 · 장면 1 · 장면 2 · 장면 3** | 변경 E · 보완 1-C |
| `Supplier-Landing` | `/supplier` | **자동 재생 · 장면 1 · 장면 2 · 장면 3** | 변경 E · 보완 1-C |
| `Account-Client` | `/c/account` | **증빙 정보 바꾸기 · 증빙 정보 오류 · 증빙 정보 저장 완료** | 보완 1-1 |
| `Account-Supplier` | `/s/account` | **1원 보냄 · 1원 인증 실패 · 인증 완료 · 계좌 변경 완료** | 보완 1-2 |
| `Cancel-Client` | `/c/contracts/:cid/cancel` | **요청 철회 확인** | 보완 1-3 |
| `Cancel-Supplier` | `/s/contracts/:cid/cancel` | **요청 철회됨** | 보완 1-3 |
| `Contracts-Client` | `/c/contracts` | **취소 요청 철회됨** | 보완 1-3 |
| `Admin-Blocks` | `/admin/blocks` | **병합 완료 · 단가 수정 완료 · 비활성화 완료** | 보완 1-5 |
| `Admin-Reports` | `/admin/reports` | **문제 없음 선택 · 채팅 7일 제한 선택 · 처리 완료 — 문제 없음 · 처리 완료 — 채팅 7일 제한 · 처리 완료 — 계정 정지** | 보완 1-6 |
| `Admin-Disputes` | `/admin/disputes` | **판정 작성 — 보완이 맞다 · 판정 작성 — 승인이 맞다 · 판정 완료 — 보완이 맞다 · 판정 완료 — 승인이 맞다** | 보완 1-7 |
| `Inspect-Client` | `/c/contracts/:cid/inspect` | **보완 요청 보냄 · 도움 요청 보냄** | 보완 1-8 |
| `Deliver-Supplier` | `/s/contracts/:cid/deliver` | **도움 요청 · 도움 요청 보냄** | 보완 1-9 |
| `Apps-Supplier` | `/s/applications` | **지원 철회됨** | 보완 1-10 |
| `Contract-Supplier` | `/s/contracts/:cid` | **결렬 — 서명 거절함** | 보완 1-10 |
| `Contract-Client` | `/c/contracts/:cid` | **결렬 — 임시 계약 취소함** | 보완 1-10 |
| `Compare-Client` | `/c/projects/:pid/proposals` | **거절함** | 보완 1-10 |

- 기존 상태 이름은 바꾸지 않았다 — `Admin-Reports`의 `조치 작성` · `처리 완료` = 경고, `Admin-Disputes`의 `판정 작성` · `판정 완료` = 정하지 않은 조건
- 확인 모달의 확정 버튼은 **위 '뒤' 상태로 이어지게** 연결한다(지금까지 자기 화면으로 돌아가기만 했던 곳)
- 캔버스 예시 사유 칸의 '(○○를 고른 경우의 예시)'는 표시용 — 구현은 빈 칸
- 공통으로만 바뀐 보드(푸터 · 알림 · 운영자 메뉴)는 화면 작업이 없다 — 작업 1에서 끝난다

---

## 3. Claude Code에 붙여 넣을 지시

### 작업 0 — 문서 교체 (직접)

`마자용-1104-claude-code.zip`을 리포지토리 루트에 풀어 `docs/`를 덮어쓴다(보드 57 + `_discarded/` 4, 위 표의 문서들).

### 작업 1 — 공통 파일 (먼저, 한 번에)

```text
docs/Claude-Code-전달-1104.md를 먼저 읽고, 11/04 변경 중 공통 파일 몫을 반영해 줘.
이번 작업만 AGENTS.md의 '고치지 않는 것' 규칙의 예외다 — 아래 파일만 고치고 화면(pages) 내부 구현은 하지 마.

1. routes.ts
   - 새 화면 2개: Help-Inquiry(/help/inquiry · shell viewer · guard none · Help 뒤),
     Admin-Inquiries(/admin/inquiries · shell admin · guard admin · Admin-Reports 뒤). EXTRA_ROUTES의 /help/inquiry 삭제
   - Terms.shell → viewer
   - states를 docs/Claude-Code-전달-1104.md 2절 표대로 갱신(Help에서 1:1 문의 상태 제거, 오늘 생긴 상태 추가)
   - 화면 57개 = 비로그인 · 공통 11 + 의뢰인 22 + 공급자 17 + 운영자 7 (주석 숫자도)
2. pages/public/Help-Inquiry.tsx · pages/admin/Admin-Inquiries.tsx — 다른 화면처럼 ScreenPlaceholder로 만들고 라우터에 연결
3. menus.ts — 운영자 메뉴 '신고 처리' 다음 '1:1 문의'(배지 = 답변 대기 수, 시연 4) /
   의뢰인 랜딩 메뉴 #how · #safe · #start / 공급자 랜딩 메뉴 견적 방식 #how · 이용 흐름 #flow · 정산 · 비용 #price
4. 공통 푸터 — docs/디자인-보완-1104.md Part 1-C 규격으로 다시 그린다(navy-900, 1줄 로고 · 소개 | 고객센터 연락처,
   2줄 링크 그룹 3개, 3줄 사업자 정보 + 오른쪽 저작권 + 중개자 고지). '1:1 문의' → /help/inquiry. tokens.css --footer-height: 256px
   viewer 셸의 비로그인 헤더 = '의뢰인 안내 · 공급자 안내 · 고객센터 / 로그인 · 회원가입' 확인
5. 알림 시연 데이터 — INQUIRY_ANSWERED 한 줄씩(docs/변경사항-1104.md 작업 1의 5번 문구), targetUrl /help/inquiry?tab=my&id=<id>
6. Chip 톤 — 답변 대기 amber · 답변 완료 teal / 처리 완료 · 단가 수정됨 teal / 병합됨 · 비활성 · 철회함 · 직접 거절 · 결렬 · 서명 거절 · 취소함 아웃라인 /
   운영자 확인 중 · 다시 납품 기다리는 중 중립(회색)
7. packages/types · mocks — 1:1 문의 API는 공간별(결정메모 #18): /api/c/inquiries · /api/s/inquiries · /api/admin/inquiries(+ POST /:id/answer).
   타입은 client · supplier · admin에 따로(common에 두지 않음). 목업 handlers만, 실제 API 구현은 하지 않는다
8. 테스트 — 경로 57개, 새 경로 가드, Terms 셸 viewer, 새 상태 이름이 routes.ts에 있는지
9. 문서 — AGENTS.md · README.md · docs/boards/README.md의 화면 수(57) · 보드 수(61), '하지 않는 것'에서 운영자 1:1 문의 · 내 문의 삭제

끝나면 pnpm typecheck && pnpm test && pnpm build 통과 → 고친 파일만 커밋
메시지: [공통] 11/04 변경 — 1:1 문의 2화면 · 약관 공통 · 랜딩 메뉴 · 푸터
마지막에 고친 파일 목록과, 문서와 다르게 한 것이 있으면 그 이유를 보고해 줘.
```

### 작업 2 — 화면 (작업 1 커밋 뒤, 보드별)

이미 구현한 보드는 바뀐 부분만 덮어쓰고, 아직이면 최신 보드로 처음부터 만든다. 아래 틀에서 `<보드>` · `<근거>`만 바꾼다.

```text
AGENTS.md를 따른다. 보드 <보드>를 11/04 변경까지 반영해 구현해 줘.
- 원본: docs/boards/<보드>.dc.html — 마크업 · <style> · data-props(상태) · renderVals(상태별 값)
- 오늘 바뀐 것: <근거> (docs/Claude-Code-전달-1104.md 2절 표의 '근거' 칸)
- 규격: docs/디자인-시스템-v0.2.1-최종본.md / 정책: docs/PRD-v0.7-최종본.md
- 모든 상태를 ?mock=<상태>로(상태 이름은 routes.ts). 확인 모달의 확정 버튼은 그 뒤 상태로 이어지게
- 고칠 수 있는 파일: pages/<공간>/<보드>.tsx · .data.ts · .module.css · test/<보드>.test.tsx 만
- 1440 · 390 폭에서 보드와 나란히 확인
끝나면 pnpm typecheck && pnpm test && pnpm build → 그 보드 파일만 커밋, 메시지 [<보드>] 한 줄 요약
```

| 순서 | 보드 | 근거 | 덧붙일 말 |
|---|---|---|---|
| 1 | `Help-Inquiry` | 변경사항 B | 새 화면. 비로그인 안내 · 문의하기 · 보낸 뒤 · 내 문의 모두 |
| 2 | `Admin-Inquiries` | 변경사항 A | 새 화면. 사이드 메뉴는 셸 몫 |
| 3 | `Help` | 변경사항 C · 보완 1-4 | FAQ 14개, 공지는 펼침 목록(목록 · 상세 화면 만들지 않음) |
| 4 | `Terms` | 변경사항 D | 셸만 바뀜 — 문구 한 줄 |
| 5 | `Main` · `Supplier-Landing` | 변경사항 E · 보완 1-C | CSS 애니메이션만, reduced-motion이면 마지막 장면 정지, 마지막 띠 navy-700 |
| 6 | `Account-Client` · `Account-Supplier` | 보완 1-1 · 1-2 | |
| 7 | `Cancel-Client` · `Cancel-Supplier` · `Contracts-Client` | 보완 1-3 | 철회는 동의 대기 중에만, 철회하면 멈춘 일수만큼 기한 연장(결정 #19 · #20) |
| 8 | `Admin-Blocks` · `Admin-Reports` · `Admin-Disputes` | 보완 1-5 · 1-6 · 1-7 | 처리 뒤 teal 띠 + 이벤트 기록 링크 |
| 9 | `Inspect-Client` · `Deliver-Supplier` | 보완 1-8 · 1-9 · Part 2(2-3) | 도움 요청 모달은 두 화면이 같은 틀 |
| 10 | `Apps-Supplier` · `Contract-Supplier` · `Contract-Client` · `Compare-Client` | 보완 1-10 | `Quote-Client` · `QuoteView-Supplier`의 거절 · 철회도 이 상태로 이어진다 |
| 11 | Part 2의 7건 | 보완 Part 2 | 새 화면 없이 '구현 메모'대로 연결 |

---

## 4. 확정한 것 (11/04 · 권고안 채택 — 결정메모 #19~#23)

남은 확인 항목 없음. 아래는 PM이 권고안대로 확정했고, 캔버스에 그린 그대로다.

| # | 항목 | 확정 | 근거 |
|---|---|---|---|
| 19 | 취소 요청 철회 가능 시점 | **상대가 답하기 전(동의 대기)까지만.** 동의 · 이의 · 3일 경과(운영자 판정)부터는 철회 버튼을 보이지 않고, API는 조건부 갱신으로 막는다 | 보완 1-3 |
| 20 | 철회 뒤 기한 | **멈춘 일수만큼 작업 마감과 진행 중 검수 기한을 늦춘다.** 철회는 계약당 취소 요청 1회 제한에 세지 않는다 | 보완 1-3 |
| 21 | '보완이 맞다' 판정 뒤 항목 상태 | **다시 납품할 때까지 '보완 요청'**, 다시 납품하면 '검수 대기' + 검수 기한 7일 새로. 보완 요청 중에는 자동 승인 대상이 아니다 | 보완 1-7 |
| 22 | 채팅 7일 제한 확정 버튼 | **파란 기본 버튼.** 위험(warn) 버튼은 계정 정지만(PRD F-24) | 보완 1-6 |
| 23 | 블록 '다시 켜기' | **이번 범위는 버튼만**(동작 없음). 켜기 동작은 '전체 블록' 탭과 함께 MVP 뒤 | 보완 1-5 |
