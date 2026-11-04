# 화면 점검 — 빈 버튼 · 없는 화면

점검 범위: 구현한 57개 화면을 디자인에 있는 모든 상태(308페이지)로 렌더링하고, 그 안의 링크와 버튼을 전부 뽑아 확인했습니다.
기준일: 2026-11-04

## 요약

| 구분 | 개수 | 뜻 |
|---|---|---|
| 다른 화면으로 가는 링크 | 1,289 | 정상. 깨진 링크 없음 |
| 같은 페이지 안 이동(`#id`) | 8 | 정상 |
| `#` 링크 (가는 곳 없음) | 196 | 눌러도 아무 일 없음 |
| 동작 없는 버튼 | 105 | 눌러도 아무 일 없음 |
| 자기 화면으로 돌아오기만 하는 링크 | 약 110 | 연결된 것처럼 보이지만 화면 변화 없음 |
| 비활성 버튼 (의도됨) | 21 | 정상 |

빈 버튼과 링크는 아래 세 가지로 나뉩니다.

- **A. 디자인된 상태가 이미 있음:** 화면은 디자인돼 있는데 버튼과 연결이 안 된 경우입니다. 프론트엔드에서 지금 바로 고칠 수 있고, 가장 많습니다.
- **B. 디자인이 없음:** 버튼이 가리키는 화면이나 상태 자체가 디자인에 없습니다. 디자인을 먼저 정해야 합니다.
- **C. 데이터나 백엔드가 있어야 의미 있음:** 목록 필터, 더 보기, 채팅 보내기처럼 실제 데이터가 있어야 동작하는 것입니다. 프론트에서는 자리와 동작 틀만 만들 수 있습니다.

---

## A. 디자인된 상태가 있음 — 연결만 하면 됨

> **연결 완료.** 아래 표의 항목은 모두 연결했습니다. `npm run check:links`로 잘못된 상태 이름이 없는지 확인합니다.
> 연결하면서 디자인에 결과 상태가 없다는 것이 드러난 버튼은 B의 "연결하면서 추가로 확인된 것"으로 옮겼습니다.

버튼을 누르면 해당 상태(주소의 `?view=…` 등)로 가게 하면 됩니다. 모달의 `×`, `취소`, `닫기`는 기본 상태로 돌아가게 합니다.

| 화면 | 버튼 / 링크 | 연결할 상태 |
|---|---|---|
| Account-Client | 이메일 바꾸기 · 연결 해제 · 탈퇴하기 · 비밀번호 바꾸기 | 이메일 바꾸기 · 구글 연결 해제 · 탈퇴 확인 · 비밀번호 변경 완료 |
| Account-Supplier | 이메일 바꾸기 · 계좌 바꾸기 · 탈퇴하기 · 비밀번호 바꾸기 | 이메일 바꾸기 · 계좌 바꾸기 · 탈퇴 확인 · 비밀번호 변경 완료 |
| Admin-Blocks | 병합 · 단가 수정 · 비활성화 | 병합 · 단가 수정 · 비활성화 |
| Admin-Disputes | 검토 중 / 판정 완료 탭, 판정 보내기 | 검토 중 · 판정 완료 · 판정 작성 |
| Admin-Events | 표의 각 행, 상세 `×` | 상세 · 목록 |
| Admin-Inquiries | 답변 대기 / 답변 완료 탭, 목록 항목, 답변 보내기 | 답변 대기 · 답변 완료 탭 · 답변 작성 · 답변 보냄 |
| Admin-Payments | 금액 불일치 항목, 예치 완료로 확정 | 금액 불일치 · 확정 |
| Admin-Refunds | 처리 대기 / 판정 필요 / 판정 완료 탭, 처리 완료로 표시, 판정 확정 | 처리 대기 · 사유 다툼 판정 · 처리 완료 |
| Admin-Reports | 처리 대기 / 처리 완료 탭, 신고 항목, 조치 확정 | 처리 대기 · 처리 완료 · 조치 작성 |
| Apps-Supplier | 전체 / 보류 탭, 지원 철회 | 전체 · 보류 중 · 지원 철회 확인 |
| QuoteView-Supplier | 지원 철회 | Apps-Supplier의 지원 철회 확인 |
| Cancel-Supplier | 이의 제기 · 이의 보내기 · 동의 | 이의 작성 · 운영자 판정 중 · 정산 확정 |
| Cancel-Client | 취소 요청 보내기 | 동의 대기 |
| Chat-Client | 신고 · 신고하기 | 신고 |
| Chat-Supplier | 견적 수정 · 신고 | 견적 수정 · 신고 |
| Compare-Client, Quote-Client | 거절 · 거절하기 | 거절 확인 |
| Contract-Client | 서명하기 · 임시 계약 취소 | 양쪽 서명 완료 · 임시 계약 취소 확인 |
| Contract-Supplier | 서명하기 · 서명 거절 | 양쪽 서명 완료 · 서명 거절 확인 |
| Deliver-Supplier | 중간 납품 제출 · 최종 납품 제출 · 다시 제출 | 제출함 · 검수 대기 |
| Draft-Client | 예산을 이 금액으로 맞추기 · 다시 만들기 | budgetApplied · 초안 만드는 중 |
| Escrow-Client | 예치하기 | 확인 중 → 예치 완료 |
| Find-Supplier | 북마크 탭, 검색 | 북마크 · 검색 결과 없음 |
| Help | 검색 | 검색 결과 |
| Home-Client, Home-Supplier | 오른쪽 위 내 이름(프로필 메뉴) | menuOpen |
| Input-Client, My-Client | 삭제 → 삭제하기 / 취소 | deleteConfirm |
| Inspect-Client | 보완 요청 · 승인 · 도움 요청 · 각 보내기 버튼 | 보완 요청 작성 · 승인 확인 · 도움 요청 · 중간 승인 완료 |
| Notify-Client, Notify-Supplier | 모두 읽음 | 모두 읽음 |
| Profile-Client | 기본 정보 / 받은 리뷰 탭 | 기본 정보 · 받은 리뷰 |
| Profile-Supplier | 기본 정보 / 받은 리뷰 탭, 숨기기 · 다시 보이기 · 확인하고 공개 | 받은 리뷰 · 숨김 · 공개 중 |
| Reset | 재설정 메일 보내기 · 다시 받기 | 메일 보냄 · 이메일 입력 |
| Review-Client, Review-Supplier | 별점, 칭찬 태그 선택 | 화면 안에서 선택 상태 바꾸기 |
| Spec-Client | 마감 연장 | 마감 연장 |
| Terms | 이용약관 · 개인정보 처리방침 · 명세 비밀유지 · 중개자 고지 탭 | 같은 이름의 상태 |

## B. 디자인이 없음 — 먼저 정해야 함

버튼은 있는데 눌렀을 때 보여 줄 화면이나 상태가 디자인에 없습니다.

**없는 화면**

| 버튼이 있는 곳 | 버튼 | 필요한 화면 |
|---|---|---|
| Help, 모든 화면의 푸터 | 공지사항 · 공지 제목("마자용 서비스를 시작합니다" 등) | 공지사항 목록과 공지 상세. 지금은 고객센터로만 갑니다 |
| Help | FAQ 분류(예상 금액, 환불 · 취소, 수수료 …) · 전체 보기 | 분류별 FAQ 목록 |
| Deliver-Supplier, Inspect-Client | 제출한 결과물 보기 · 납품물 다시 보기 | 납품물 상세 |
| Admin-Blocks | 병합 후보 · 전체 블록 · 단가 수정 기록 탭, 블록 항목 | 탭별 목록, 블록 상세 |
| Admin-Payments | 보류 · 처리 완료 탭 | 탭별 목록 |
| Notify-Client, Notify-Supplier | 알림 전체 | 알림 전체 페이지(지금은 드롭다운만 있음) |

**없는 상태나 모달**

| 화면 | 버튼 | 빠진 것 |
|---|---|---|
| Account-Client | 증빙 정보 바꾸기 | 사업자번호 · 세금계산서 이메일 수정 모달 |
| Account-Supplier | 1원 보내기 | 계좌 1원 인증 다음 단계(인증번호 입력, 성공, 실패) |
| Cancel-Client | 요청 철회 | 취소 요청 철회 확인 |
| Admin-Payments | 결제사에 다시 조회 · 결제 취소 · 다시 결제 요청 | 조회 결과와 취소 확인 |
| Admin-Blocks | 그대로 두기 | 처리 뒤 상태 |
| Settle-Supplier | 발행했어요 | 세금계산서 발행 표시 뒤 상태 |
| Contract-Client, Contract-Supplier | 계약서 내려받기 | PDF 양식(파일로만 줄 것인지도 정해야 함) |
| Settle-Client, Settle-Supplier | 수수료 증빙 받기 · 원천징수영수증 | 증빙 양식 또는 내려받기 방식 |
| QuoteWrite-Supplier | + 질문 추가 | 질문 입력 줄이 추가된 모습 |
| Draft-Client | 메모 남기기 · 되돌리기 · 추천 기능 카드 | 메모 입력, 되돌린 뒤, 추천을 반영한 뒤 |

**연결하면서 추가로 확인된 것:** 확인 모달까지는 열리지만, 그 안의 확정 버튼을 누른 뒤의 화면이 디자인에 없습니다.

| 화면 | 버튼 | 빠진 것 |
|---|---|---|
| Admin-Blocks | 병합 · 단가 수정 · 비활성화 모달의 확정 버튼 | 처리한 뒤의 목록 |
| Admin-Reports | 조치 중 '문제 없음' · '채팅 7일 제한' 선택 | 이 두 조치를 고른 상태 (경고 · 계정 정지만 있음) |
| Admin-Disputes | 판정 선택지 3개 | 고른 선택지별 상태 (지금은 모두 같은 판정 작성 화면) |
| Inspect-Client | 보완 요청 보내기 · 도움 요청 보내기 | 보낸 뒤 상태 |
| Escrow-Client | 확인 중 → 예치 완료 | 결제사 응답으로 넘어가므로 백엔드 연결 때 처리 |
| Apps-Supplier, Contract-*, Compare-Client, Quote-Client | 지원 철회 · 서명 거절 · 임시 계약 취소 · 거절하기 (확인 모달 안의 버튼) | 처리한 뒤 상태 |
| Deliver-Supplier | 운영자에게 도움 요청 | 이 화면의 도움 요청 상태 |

## C. 데이터나 백엔드가 있어야 의미 있음

프론트에서는 동작하는 틀만 미리 만들 수 있고, 실제 내용은 백엔드 연결 때 채워집니다.

- **목록 필터 탭:** My-Client(작성 중 · 모집 · 완료), Settle-Client · Settle-Supplier(진행 중 · 완료 · 결렬 · 취소), Notify(전체 · 안 읽음), Admin-Events(행위자 필터, 페이지 2 · 3), Find-Supplier(필터 지우기 · 내 기술 스택으로 보기)
- **더 보기:** 이전 계약 10건 더 보기, 이전 리뷰 8건 더 보기, 리뷰 12건 모두 보기
- **채팅:** 대화 목록의 다른 대화방, 보내기, 추천 질문 버튼
- **북마크 토글:** Find-Supplier, Project-Supplier
- **파일 · 이미지 올리기:** 프로필 이미지, 포트폴리오 파일, 1:1 문의 첨부. 파일 선택 창은 프론트에서 바로 붙일 수 있음
- **저장 · 제출:** 프로필 저장하기, 문의 보내기, 로그인, 가입 등. 다음 화면으로 가는 링크는 이미 있고, 실제 저장은 백엔드 몫
- **외부 링크:** 포트폴리오 주소, 의뢰인 가게 사이트, 검수용 테스트 주소. 지금은 예시 주소라 링크를 걸지 않았고, 실제 데이터가 들어오면 연결

## 문제 없음 (의도된 것)

- Login 화면 뒤쪽의 랜딩 메뉴(작동 방식 · 안전장치 · 비용 · 견적 방식)는 모달 뒤 배경이라 눌리지 않는 게 맞습니다.
- `off` 표시나 `disabled`가 붙은 버튼 21개는 디자인상 비활성입니다. 예: 탈퇴할 수 없을 때의 탈퇴하기 버튼.
- 디자인에서 폐기한 4개 화면(Agree, Accept-Client, Rates, Signup-Rates)은 다른 화면에서 링크하지 않습니다.

---

## 부록 — 스캔한 항목 전체

같은 화면에서 텍스트와 주소가 같은 항목은 하나로 합쳤습니다.

| 화면 | 종류 | 표시 텍스트 | 주소 |
|---|---|---|---|
| Account-Client | 동작 없는 버튼 | × |  |
| Account-Client | `#` 링크 (대상 없음) | 이메일 바꾸기 | #email |
| Account-Client | `#` 링크 (대상 없음) | 연결 해제 | #google |
| Account-Client | `#` 링크 (대상 없음) | 탈퇴하기 | #leave |
| Account-Client | `#` 링크 (대상 없음) | 바꾸기 | #tax |
| Account-Supplier | 동작 없는 버튼 | × |  |
| Account-Supplier | `#` 링크 (대상 없음) | 계좌 바꾸기 | #bank |
| Account-Supplier | `#` 링크 (대상 없음) | 이메일 바꾸기 | #email |
| Account-Supplier | `#` 링크 (대상 없음) | 구글 연결하기 | #google |
| Account-Supplier | `#` 링크 (대상 없음) | 탈퇴하기 | #leave |
| Account-Supplier | `#` 링크 (대상 없음) | 1원 보내기 | #send1 |
| Admin-Blocks | 동작 없는 버튼 | × |  |
| Admin-Blocks | `#` 링크 (대상 없음) | 전체 블록46 | #all |
| Admin-Blocks | `#` 링크 (대상 없음) | 노쇼 관리병합 후보 계기: 노쇼 손님을 표시하고 횟수를 기록 11월 2일 | #block |
| Admin-Blocks | `#` 링크 (대상 없음) | 알레르기 사전 접수 계기: 예약할 때 손님의 알레르기 재료를 미리 받기  | #block |
| Admin-Blocks | `#` 링크 (대상 없음) | 반려동물 동반 표시 계기: 반려동물 동반 여부와 가능한 자리 표시 11월 | #block |
| Admin-Blocks | `#` 링크 (대상 없음) | 와인 페어링 추천 계기: 코스 메뉴별 어울리는 와인 추천 10월 31일  | #block |
| Admin-Blocks | `#` 링크 (대상 없음) | 주차 안내 계기: 주차 가능 여부와 제휴 주차장 안내 10월 31일 16 | #block |
| Admin-Blocks | `#` 링크 (대상 없음) | 수강권 차감 계기: 수업에 올 때마다 수강권 횟수를 차감 10월 30일  | #block |
| Admin-Blocks | `#` 링크 (대상 없음) | 방문 후 리뷰 요청병합 후보 계기: 방문 다음 날 리뷰를 부탁하는 알림  | #block |
| Admin-Blocks | `#` 링크 (대상 없음) | 비활성화 | #deactivate |
| Admin-Blocks | `#` 링크 (대상 없음) | 그대로 두기 | #keep |
| Admin-Blocks | `#` 링크 (대상 없음) | 단가 수정 기록3 | #log |
| Admin-Blocks | `#` 링크 (대상 없음) | 병합 후보2 | #merge |
| Admin-Blocks | `#` 링크 (대상 없음) | 기존 블록에 병합 | #merge |
| Admin-Blocks | `#` 링크 (대상 없음) | 새 블록7 | #new |
| Admin-Blocks | `#` 링크 (대상 없음) | 단가 수정 | #price |
| Admin-Disputes | `#` 링크 (대상 없음) | 판정 완료2 | #d |
| Admin-Disputes | `#` 링크 (대상 없음) | test.nuri-guksu.kr/reserve | #d |
| Admin-Disputes | `#` 링크 (대상 없음) | 판정 완료3 | #d |
| Admin-Disputes | `#` 링크 (대상 없음) | 검토 중1 | #o |
| Admin-Disputes | `#` 링크 (대상 없음) | 검토 중0 | #o |
| Admin-Disputes | `#` 링크 (대상 없음) | 판정 보내기 | #send |
| Admin-Events | 동작 없는 버튼 | × |  |
| Admin-Inquiries | `#` 링크 (대상 없음) | 답변 완료12 | #done |
| Admin-Inquiries | `#` 링크 (대상 없음) | 답변 완료13 | #done |
| Admin-Inquiries | `#` 링크 (대상 없음) | 답변 대기4 | #wait |
| Admin-Inquiries | `#` 링크 (대상 없음) | 답변 대기3 | #wait |
| Admin-Payments | `#` 링크 (대상 없음) | 결제 취소 · 다시 결제 요청 | #cancel |
| Admin-Payments | `#` 링크 (대상 없음) | 예치 완료로 확정 | #confirm |
| Admin-Payments | `#` 링크 (대상 없음) | 처리 완료0 | #done |
| Admin-Payments | `#` 링크 (대상 없음) | 처리 완료1 | #done |
| Admin-Payments | `#` 링크 (대상 없음) | 보류2 | #hold |
| Admin-Payments | `#` 링크 (대상 없음) | 보류1 | #hold |
| Admin-Payments | `#` 링크 (대상 없음) | 결과 통지 없음11월 4일 14:12 · 40분째 골목 파스타 · 2,1 | #pay |
| Admin-Payments | `#` 링크 (대상 없음) | 금액 불일치11월 3일 20:41 면옥 · 2,100,000원 포장 주문 | #pay |
| Admin-Payments | `#` 링크 (대상 없음) | 예치 완료로 확정14:53골목 파스타 · 2,100,000원결제 건 •• | #pay |
| Admin-Payments | `#` 링크 (대상 없음) | 결제사에 다시 조회 | #requery |
| Admin-Refunds | `#` 링크 (대상 없음) | 판정 확정 | #confirm |
| Admin-Refunds | `#` 링크 (대상 없음) | 처리 완료2 | #d |
| Admin-Refunds | `#` 링크 (대상 없음) | 처리 완료3 | #d |
| Admin-Refunds | `#` 링크 (대상 없음) | 처리 완료로 표시 | #done1 |
| Admin-Refunds | `#` 링크 (대상 없음) | 처리 완료로 표시 | #done2 |
| Admin-Refunds | `#` 링크 (대상 없음) | 판정 필요0 | #j |
| Admin-Refunds | `#` 링크 (대상 없음) | 판정 필요1 | #j |
| Admin-Refunds | `#` 링크 (대상 없음) | 처리 대기1 | #p |
| Admin-Refunds | `#` 링크 (대상 없음) | 처리 대기0 | #p |
| Admin-Reports | `#` 링크 (대상 없음) | 처리 완료5 | #done |
| Admin-Reports | `#` 링크 (대상 없음) | 처리 완료6 | #done |
| Admin-Reports | `#` 링크 (대상 없음) | 처리 대기2 | #wait |
| Admin-Reports | `#` 링크 (대상 없음) | 처리 대기1 | #wait |
| Agreement-Client | 동작 없는 버튼 | × |  |
| Apps-Supplier | 동작 없는 버튼 | 지원 철회 |  |
| Apps-Supplier | 동작 없는 버튼 | 서명 거절 |  |
| Apps-Supplier | 동작 없는 버튼 | × |  |
| Apps-Supplier | 동작 없는 버튼 | 돌아가기 |  |
| Apps-Supplier | `#` 링크 (대상 없음) | 전체7 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 검토 중1 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 문의 중2 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 선택됨0 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 보류1 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 종료3 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 문의 중1 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 선택됨1 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 전체5 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 검토 중3 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 문의 중0 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 보류0 | #apps |
| Apps-Supplier | `#` 링크 (대상 없음) | 종료2 | #apps |
| Cancel-Client | 동작 없는 버튼 | 요청 철회 |  |
| Cancel-Supplier | `#` 링크 (대상 없음) | 동의 | #agree |
| Cancel-Supplier | `#` 링크 (대상 없음) | 이의 제기 | #objection |
| Cancel-Supplier | `#` 링크 (대상 없음) | 이의 보내기 | #send |
| Chat-Client | 동작 없는 버튼 | 보내기 |  |
| Chat-Client | 동작 없는 버튼 | × |  |
| Chat-Client | 동작 없는 버튼 | 리마인드 알림을 빼신 이유가 궁금해요 |  |
| Chat-Client | 동작 없는 버튼 | 예약금 환불 기준은 어떻게 정하면 좋을까요? |  |
| Chat-Client | 동작 없는 버튼 | 작업 기간 56일을 줄일 수 있을까요? |  |
| Chat-Client | `#` 링크 (대상 없음) | 최 최준호09:12 노쇼 판정 기준도 정해 두면 좋겠습니다 문의 중 | #chat-cjh |
| Chat-Client | `#` 링크 (대상 없음) | 최 최준호11월 4일 감사합니다. 중간 납품은 11월 25일로… 계약 체 | #chat-cjh |
| Chat-Client | `#` 링크 (대상 없음) | 최 최준호09:12 마자용 밖에서 직접 계약하시면 수수료 없이… 문의 중 | #chat-cjh |
| Chat-Client | `#` 링크 (대상 없음) | 최 최준호09:12 노쇼 판정 기준도 정해 두면 좋겠습니다 이전 명세 기 | #chat-cjh |
| Chat-Client | `#` 링크 (대상 없음) | 최 최준호11월 4일 계약이 체결되었습니다 계약 체결 | #chat-cjh |
| Chat-Client | `#` 링크 (대상 없음) | 최 최준호09:30 최종 합의 내용으로 임시 계약이 되었습니다 임시 계약 | #chat-cjh |
| Chat-Client | `#` 링크 (대상 없음) | 최 최준호09:12 노쇼 판정 기준도 정해 두면 좋겠습니다 문의 중1 | #chat-cjh |
| Chat-Client | `#` 링크 (대상 없음) | 김 김세라11월 2일 전날 취소는 전액 환불로 두는 게 좋겠습니다 문의  | #chat-ksr |
| Chat-Client | `#` 링크 (대상 없음) | 김 김세라11월 2일 전날 취소는 전액 환불로 두는 게 좋겠습니다 자동  | #chat-ksr |
| Chat-Client | `#` 링크 (대상 없음) | 김 김세라11월 2일 전날 취소는 전액 환불로 두는 게 좋겠습니다 이전  | #chat-ksr |
| Chat-Client | `#` 링크 (대상 없음) | 김 김세라11월 4일 전날 취소는 전액 환불로 두는 게 좋겠습니다 자동  | #chat-ksr |
| Chat-Client | `#` 링크 (대상 없음) | 김 김세라11월 2일 전날 취소는 전액 환불로 두는 게 좋겠습니다 보류 | #chat-ksr |
| Chat-Client | `#` 링크 (대상 없음) | 넛 스튜디오 넛지금 아직 메시지가 없습니다 문의 전 | #chat-nut |
| Chat-Supplier | 동작 없는 버튼 | 견적 수정 |  |
| Chat-Supplier | 동작 없는 버튼 | 신고 |  |
| Chat-Supplier | 동작 없는 버튼 | 보내기 |  |
| Chat-Supplier | 동작 없는 버튼 | 취소 |  |
| Chat-Supplier | 동작 없는 버튼 | 수정 보내기 |  |
| Chat-Supplier | 동작 없는 버튼 | × |  |
| Chat-Supplier | 동작 없는 버튼 | 신고하기 |  |
| Chat-Supplier | `#` 링크 (대상 없음) | 김 김도담 · 담소 키친11월 1일 회차 예약, 알레르기 사전 접수 외  | #chat-dsk |
| Chat-Supplier | `#` 링크 (대상 없음) | 서 서하루 · 하루 베이커리10월 30일 전화 예약 대체, 대기 명단 외 | #chat-hsy |
| Chat-Supplier | `#` 링크 (대상 없음) | 정 정민재 · 온도 다이닝09:12 예약 달력, 예약금 결제 외 2개 기 | #chat-jmj |
| Chat-Supplier | `#` 링크 (대상 없음) | 정 정민재 · 온도 다이닝16:32 예약 달력, 예약금 결제 외 2개 기 | #chat-jmj |
| Chat-Supplier | `#` 링크 (대상 없음) | 정 정민재 · 온도 다이닝09:30 예약 달력, 예약금 결제 외 2개 기 | #chat-jmj |
| Compare-Client | 동작 없는 버튼 | 거절 |  |
| Compare-Client | 동작 없는 버튼 | × |  |
| Contract-Client | 동작 없는 버튼 | 임시 계약 취소 |  |
| Contract-Client | 동작 없는 버튼 | × |  |
| Contract-Client | `#` 링크 (대상 없음) | 계약서 내려받기 | #pdf |
| Contract-Client | `#` 링크 (대상 없음) | 서명하기 | #signed |
| Contract-Supplier | 동작 없는 버튼 | 서명 거절 |  |
| Contract-Supplier | 동작 없는 버튼 | × |  |
| Contract-Supplier | 동작 없는 버튼 | 돌아가기 |  |
| Contract-Supplier | `#` 링크 (대상 없음) | 계약서 내려받기 | #pdf |
| Contract-Supplier | `#` 링크 (대상 없음) | 서명하기 | #signed |
| Contracts-Supplier | `#` 링크 (대상 없음) | 이전 완료 계약 10건 더 보기 | #more |
| Deliver-Supplier | 동작 없는 버튼 | 중간 납품 제출 |  |
| Deliver-Supplier | 동작 없는 버튼 | 최종 납품 제출 |  |
| Deliver-Supplier | 동작 없는 버튼 | 다시 제출 |  |
| Deliver-Supplier | `#` 링크 (대상 없음) | 최종 구간 · 2건 중간 뒤 | #fin |
| Deliver-Supplier | `#` 링크 (대상 없음) | 최종 구간 · 2건 마감 지남 | #fin |
| Deliver-Supplier | `#` 링크 (대상 없음) | 최종 구간 · 2건 작성 중 | #fin |
| Deliver-Supplier | `#` 링크 (대상 없음) | 같은 문제로 보완이 반복되면 운영자에게 도움 요청 | #help |
| Deliver-Supplier | `#` 링크 (대상 없음) | 중간 구간 · 2건 작성 중 | #mid |
| Deliver-Supplier | `#` 링크 (대상 없음) | 중간 구간 · 2건 지급 완료 | #mid |
| Deliver-Supplier | `#` 링크 (대상 없음) | 중간 구간 · 2건 보완 요청 | #mid |
| Deliver-Supplier | `#` 링크 (대상 없음) | 중간 구간 · 2건 검수 중 | #mid |
| Deliver-Supplier | `#` 링크 (대상 없음) | 제출한 결과물 보기 | #sub |
| Draft-Client | 동작 없는 버튼 | × |  |
| Draft-Client | 동작 없는 버튼 | 노쇼가 나도 재료값은 돌려받고 싶다면 노쇼 위약금 자동 청구 |  |
| Draft-Client | 동작 없는 버튼 | 예약마다 규정을 직접 안내하고 계신다면 예약 확정 문자 |  |
| Draft-Client | 동작 없는 버튼 | 뜸해진 단골에게 먼저 연락하고 싶다면 재방문 알림 |  |
| Draft-Client | 동작 없는 버튼 | 단골 손님 취향을 기억해 두고 싶다면 알레르기·선호 메모 |  |
| Draft-Client | 동작 없는 버튼 | 메모 남기기 |  |
| Draft-Client | 동작 없는 버튼 | 되돌리기 |  |
| Draft-Client | 동작 없는 버튼 | 예산을 이 금액으로 맞추기 |  |
| Draft-Client | 동작 없는 버튼 | 반영하기 |  |
| Draft-Client | 동작 없는 버튼 | 취소 |  |
| Escrow-Client | `#` 링크 (대상 없음) | 3,255,000원 예치하기 | #pay |
| Escrow-Client | `#` 링크 (대상 없음) | 다시 결제하기 | #pay |
| Find-Supplier | 동작 없는 버튼 | 검색 |  |
| Find-Supplier | 동작 없는 버튼 | 북마크 |  |
| Find-Supplier | `#` 링크 (빈 값) | 초기화 | # |
| Find-Supplier | `#` 링크 (빈 값) | 내 스택 | # |
| Find-Supplier | `#` 링크 (빈 값) | 필터 모두 지우기 | # |
| Find-Supplier | `#` 링크 (빈 값) | 2 | # |
| Find-Supplier | `#` 링크 (빈 값) | 3 | # |
| Find-Supplier | `#` 링크 (빈 값) | 다음 | # |
| Help | 동작 없는 버튼 | 검색 |  |
| Help-Inquiry | 동작 없는 버튼 | 파일 올리기 |  |
| Home-Client | 동작 없는 버튼 | 민정민재 |  |
| Home-Supplier | 동작 없는 버튼 | 최최준호 |  |
| Input-Client | 동작 없는 버튼 | 보관하기 |  |
| Input-Client | 동작 없는 버튼 | 삭제 |  |
| Input-Client | 동작 없는 버튼 | 취소 |  |
| Input-Client | 동작 없는 버튼 | 삭제하기 |  |
| Inspect-Client | 동작 없는 버튼 | × |  |
| Inspect-Client | `#` 링크 (대상 없음) | 취소 | #cancel |
| Inspect-Client | `#` 링크 (대상 없음) | 최종 구간 · 2건 납품 전 | #fin |
| Inspect-Client | `#` 링크 (대상 없음) | 최종 구간 · 2건 작업 중 · 납품 기다리는 중 | #fin |
| Inspect-Client | `#` 링크 (대상 없음) | 최종 구간 · 2건 검수 대기 | #fin |
| Inspect-Client | `#` 링크 (대상 없음) | 보완 요청 | #fix |
| Inspect-Client | `#` 링크 (대상 없음) | 같은 문제로 보완이 반복되면 운영자에게 도움 요청 | #help |
| Inspect-Client | `#` 링크 (대상 없음) | 중간 구간 · 2건 검수 대기 | #mid |
| Inspect-Client | `#` 링크 (대상 없음) | 중간 구간 · 2건 지급 완료 | #mid |
| Inspect-Client | `#` 링크 (대상 없음) | 승인 | #ok |
| Inspect-Client | `#` 링크 (대상 없음) | https://test.ondo-dining.kr/admin/slots | #open |
| Inspect-Client | `#` 링크 (대상 없음) | https://test.ondo-dining.kr/reserve | #open |
| Inspect-Client | `#` 링크 (대상 없음) | https://test.ondo-dining.kr/admin/noshow | #open |
| Inspect-Client | `#` 링크 (대상 없음) | https://test.ondo-dining.kr/admin/remind | #open |
| Inspect-Client | `#` 링크 (대상 없음) | 보완 요청 보내기 | #send |
| Inspect-Client | `#` 링크 (대상 없음) | 납품물 다시 보기 | #sub |
| Login | 링크 주소 없음 | 작동 방식 |  |
| Login | 링크 주소 없음 | 안전장치 |  |
| Login | 링크 주소 없음 | 비용 |  |
| Login | 링크 주소 없음 | 견적 방식 |  |
| Login | 링크 주소 없음 | 고르는 기준 |  |
| Login | 동작 없는 버튼 | ✕ |  |
| Login | 버튼 모양 텍스트 | 화면 초안 받아보기 |  |
| Login | 버튼 모양 텍스트 | 작동 방식 보기 |  |
| Login | 버튼 모양 텍스트 | 공급자로 등록 |  |
| Login | 버튼 모양 텍스트 | 공급자로 등록하기 |  |
| My-Client | 동작 없는 버튼 | 보관하기 |  |
| My-Client | 동작 없는 버튼 | 삭제 |  |
| My-Client | 동작 없는 버튼 | 취소 |  |
| My-Client | 동작 없는 버튼 | 삭제하기 |  |
| My-Client | `#` 링크 (대상 없음) | 전체2 | #all |
| My-Client | `#` 링크 (대상 없음) | 전체8 | #all |
| My-Client | `#` 링크 (대상 없음) | 전체0 | #all |
| My-Client | `#` 링크 (대상 없음) | 완료0 | #done |
| My-Client | `#` 링크 (대상 없음) | 완료1 | #done |
| My-Client | `#` 링크 (대상 없음) | 작성 중1 | #draft |
| My-Client | `#` 링크 (대상 없음) | 작성 중0 | #draft |
| My-Client | `#` 링크 (대상 없음) | 모집1 | #recruit |
| My-Client | `#` 링크 (대상 없음) | 모집4 | #recruit |
| My-Client | `#` 링크 (대상 없음) | 모집0 | #recruit |
| Notify-Client | 동작 없는 버튼 | 모두 읽음 |  |
| Notify-Client | `#` 링크 (대상 없음) | 전체 6 | #all |
| Notify-Client | `#` 링크 (대상 없음) | 전체 5 | #all |
| Notify-Client | `#` 링크 (대상 없음) | 안 읽음 4 | #unread |
| Notify-Client | `#` 링크 (대상 없음) | 안 읽음 2 | #unread |
| Notify-Client | `#` 링크 (대상 없음) | 안 읽음 0 | #unread |
| Notify-Supplier | 동작 없는 버튼 | 모두 읽음 |  |
| Notify-Supplier | `#` 링크 (대상 없음) | 전체 7 | #all |
| Notify-Supplier | `#` 링크 (대상 없음) | 전체 4 | #all |
| Notify-Supplier | `#` 링크 (대상 없음) | 안 읽음 3 | #unread |
| Notify-Supplier | `#` 링크 (대상 없음) | 안 읽음 2 | #unread |
| Notify-Supplier | `#` 링크 (대상 없음) | 안 읽음 0 | #unread |
| Profile-Client | 동작 없는 버튼 | 이미지 바꾸기 |  |
| Profile-Client | 동작 없는 버튼 | 취소 |  |
| Profile-Client | 동작 없는 버튼 | 저장하기 |  |
| Profile-Supplier | 동작 없는 버튼 | 이미지 바꾸기 |  |
| Profile-Supplier | 동작 없는 버튼 | 빼기 |  |
| Profile-Supplier | 동작 없는 버튼 | 파일 올리기 |  |
| Profile-Supplier | 동작 없는 버튼 | 다시 만들기 |  |
| Profile-Supplier | 동작 없는 버튼 | 숨기기 |  |
| Profile-Supplier | 동작 없는 버튼 | 취소 |  |
| Profile-Supplier | 동작 없는 버튼 | 저장하기 |  |
| Profile-Supplier | 동작 없는 버튼 | 다시 보이기 |  |
| Profile-Supplier | `#` 링크 (대상 없음) | 기본 정보 | #basic |
| Profile-Supplier | `#` 링크 (대상 없음) | 확인하고 공개 | #publish |
| Profile-Supplier | `#` 링크 (대상 없음) | 받은 리뷰 12 | #reviews |
| Profile-Supplier | `#` 링크 (대상 없음) | 이전 리뷰 8건 더 보기 | #reviews-all |
| Project-Supplier | 동작 없는 버튼 | 북마크 |  |
| Project-Supplier | 동작 없는 버튼 | 북마크함 |  |
| Project-Supplier | `#` 링크 (빈 값) | ondo-dining.kr | # |
| PublicClient | `#` 링크 (대상 없음) | ondo-dining.kr | #site |
| PublicSupplier | `#` 링크 (대상 없음) | junho.work | #pf |
| PublicSupplier | `#` 링크 (대상 없음) | junho-works.kr/booking | #pf |
| PublicSupplier | `#` 링크 (대상 없음) | 작업소개서.pdf | #pf |
| PublicSupplier | `#` 링크 (대상 없음) | studio-nut.kr/works | #pf |
| PublicSupplier | `#` 링크 (대상 없음) | behance.net/studionut | #pf |
| PublicSupplier | `#` 링크 (대상 없음) | 리뷰 12건 모두 보기 | #reviews |
| Quote-Client | 동작 없는 버튼 | 거절 |  |
| Quote-Client | 동작 없는 버튼 | × |  |
| QuoteView-Supplier | `#` 링크 (대상 없음) | 지원 철회 | #withdraw |
| QuoteWrite-Supplier | 동작 없는 버튼 | + 질문 추가 |  |
| Reset | 동작 없는 버튼 | 다시 보내기 |  |
| Reset | `#` 링크 (대상 없음) | 재설정 메일 다시 받기 | #ask |
| Reset | `#` 링크 (대상 없음) | 비밀번호 바꾸기 | #done |
| Reset | `#` 링크 (대상 없음) | 재설정 메일 보내기 | #sent |
| Review-Client | 동작 없는 버튼 | 1점 |  |
| Review-Client | 동작 없는 버튼 | 2점 |  |
| Review-Client | 동작 없는 버튼 | 3점 |  |
| Review-Client | 동작 없는 버튼 | 4점 |  |
| Review-Client | 동작 없는 버튼 | 5점 |  |
| Review-Client | 동작 없는 버튼 | 일정을 지켰어요 |  |
| Review-Client | 동작 없는 버튼 | 설명이 쉬웠어요 |  |
| Review-Client | 동작 없는 버튼 | 조건대로 만들었어요 |  |
| Review-Client | 동작 없는 버튼 | 보완 요청에 빨리 답했어요 |  |
| Review-Client | 동작 없는 버튼 | 다시 맡기고 싶어요 |  |
| Review-Supplier | 동작 없는 버튼 | 1점 |  |
| Review-Supplier | 동작 없는 버튼 | 2점 |  |
| Review-Supplier | 동작 없는 버튼 | 3점 |  |
| Review-Supplier | 동작 없는 버튼 | 4점 |  |
| Review-Supplier | 동작 없는 버튼 | 5점 |  |
| Review-Supplier | 동작 없는 버튼 | 조건을 분명히 정해 줬어요 |  |
| Review-Supplier | 동작 없는 버튼 | 검수가 빨랐어요 |  |
| Review-Supplier | 동작 없는 버튼 | 답장이 빨랐어요 |  |
| Review-Supplier | 동작 없는 버튼 | 요청 범위를 지켰어요 |  |
| Review-Supplier | 동작 없는 버튼 | 다시 일하고 싶어요 |  |
| Settle-Client | `#` 링크 (대상 없음) | 수수료 증빙 받기 | #receipt |
| Settle-Client | `#` 링크 (대상 없음) | 전체 | #settle |
| Settle-Client | `#` 링크 (대상 없음) | 진행 중 | #settle |
| Settle-Client | `#` 링크 (대상 없음) | 완료 | #settle |
| Settle-Client | `#` 링크 (대상 없음) | 결렬 · 취소 | #settle |
| Settle-Supplier | `#` 링크 (대상 없음) | 발행했어요 | #issued |
| Settle-Supplier | `#` 링크 (대상 없음) | 이전 계약 10건 더 보기 | #more |
| Settle-Supplier | `#` 링크 (대상 없음) | 수수료 증빙 받기 | #receipt |
| Settle-Supplier | `#` 링크 (대상 없음) | 전체 | #settle |
| Settle-Supplier | `#` 링크 (대상 없음) | 진행 중 | #settle |
| Settle-Supplier | `#` 링크 (대상 없음) | 완료 | #settle |
| Settle-Supplier | `#` 링크 (대상 없음) | 결렬 · 취소 | #settle |
| Settle-Supplier | `#` 링크 (대상 없음) | 원천징수영수증 | #wh |
| Signup-Client | 동작 없는 버튼 | 이미지 올리기 |  |
| Signup-Supplier | 동작 없는 버튼 | 이미지 올리기 |  |
| Signup-Supplier | 동작 없는 버튼 | 빼기 |  |
| Signup-Supplier | 동작 없는 버튼 | 파일 올리기 |  |
| Spec-Client | 동작 없는 버튼 | × |  |
| Spec-Client | `#` 링크 (대상 없음) | 마감 연장 | #extend |
