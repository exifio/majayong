import { BlockSource, Prisma, PrismaClient } from "@prisma/client";
import { seedBlockCatalog } from "../../core/seed.js";

export const reservationRestaurantIndustryCode = "RESTAURANT_RESERVATION";
type WireframeType = "CALENDAR" | "FORM" | "LIST" | "BUTTON" | "TEXT" | "PREVIEW";
type Candidate = {
  code: string;
  name: string;
  functionSummary: string;
  description: string;
  techTags: string[];
  wireframe: Prisma.InputJsonObject;
  conditions: Prisma.InputJsonArray;
  unitPrice: number;
  priceBasis: string;
};

function candidate(
  code: string,
  name: string,
  functionSummary: string,
  unitPrice: number,
  scope: string,
  assumption: string,
  tags: string[],
  partTypes: WireframeType[],
  conditionTexts: [string, string],
): Candidate {
  return {
    code,
    name,
    functionSummary,
    description: `${functionSummary}의 화면과 기본 동작을 제공하는 초기 제안이다.`,
    techTags: tags,
    wireframe: { parts: partTypes.map(type => ({ type, label: name, props: {} })) },
    conditions: conditionTexts.map((text, index) => ({ key: `${code.toLowerCase()}-condition-${index + 1}`, text })),
    unitPrice,
    priceBasis: `${scope}\n${assumption}\n시장 검증 및 제품 승인 전 참고 추정치(부가세 포함).`,
  };
}

const candidates: Candidate[] = [
  candidate("RR-001", "예약 가능 날짜 조회", "예약 가능한 날짜를 달력으로 확인한다.", 180_000, "월 단위 예약 가능 날짜 조회 화면을 구현.", "단일 매장과 기본 영업일 규칙을 가정.", ["calendar", "availability"], ["CALENDAR"], ["조회 가능 기간과 달력 시작 요일을 정한다.", "임시 휴무일을 달력에 표시할지 정한다."]),
  candidate("RR-002", "예약 시간대 선택", "선택한 날짜의 예약 가능 시간대를 확인하고 선택한다.", 160_000, "시간대 조회와 선택 상태 표시를 구현.", "하루의 예약 시간대가 미리 설정된 경우를 가정.", ["reservation", "timeslot"], ["CALENDAR", "BUTTON"], ["시간대 간격과 표시 순서를 정한다.", "마감된 시간대를 표시하는 방식을 정한다."]),
  candidate("RR-003", "방문 인원 선택", "방문 인원수를 선택하고 예약 가능 여부를 확인한다.", 110_000, "인원 선택 입력과 기본 범위 검증을 구현.", "최소·최대 인원 기준이 제공되는 경우를 가정.", ["reservation", "party-size"], ["FORM"], ["인원 기준을 적용할 시점을 정한다.", "기준 초과 요청을 접수할지 정한다."]),
  candidate("RR-004", "예약자 정보 입력", "예약에 필요한 방문자 정보를 입력한다.", 190_000, "예약자 정보 입력 화면과 필드 검증을 구현.", "필수 필드와 보관 기간이 별도 합의되는 경우를 가정.", ["reservation", "form"], ["FORM"], ["필수 입력 항목과 동의 문구를 정한다.", "정보 보관 기간과 삭제 방식을 정한다."]),
  candidate("RR-005", "예약 내용 확인", "예약자가 제출 전 날짜와 인원 정보를 확인한다.", 120_000, "예약 내용 미리보기와 제출 전 확인 화면을 구현.", "예약 확정 방식이 정해져 있는 경우를 가정.", ["reservation", "confirmation"], ["PREVIEW", "BUTTON"], ["확정 전 수정 가능한 항목을 정한다.", "확정 결과를 표시하는 방식을 정한다."]),
  candidate("RR-006", "매장 예약 목록 관리", "직원이 예약 목록과 예약 상태를 확인한다.", 240_000, "매장용 예약 목록과 기본 상태 표시를 구현.", "단일 매장과 기본 상태 구분을 가정.", ["admin", "reservation-list"], ["LIST", "BUTTON"], ["목록 기본 정렬과 조회 기간을 정한다.", "직원이 볼 수 있는 예약 정보를 정한다."]),
  candidate("RR-007", "매장 예약 수동 등록", "직원이 전화 등으로 받은 예약을 직접 등록한다.", 170_000, "직원용 예약 입력 화면과 기본 검증을 구현.", "온라인 예약과 같은 필수 정보를 사용하는 경우를 가정.", ["admin", "reservation-form"], ["FORM", "BUTTON"], ["수동 등록의 필수 정보와 출처 기록을 정한다.", "동일 시간대 중복 경고 방식을 정한다."]),
  candidate("RR-008", "예약 상세 조회", "직원이 예약 한 건의 상세 정보를 확인한다.", 130_000, "예약 정보 상세 화면과 상태 요약을 구현.", "목록에서 접근 권한을 확인하는 경우를 가정.", ["admin", "reservation-detail"], ["PREVIEW", "TEXT"], ["상세 화면에 표시할 필드를 정한다.", "개인정보 마스킹 범위를 정한다."]),
  candidate("RR-009", "예약 변경 요청", "예약자가 기존 예약의 변경을 요청한다.", 170_000, "변경 항목 입력과 요청 결과 표시를 구현.", "변경은 매장 확인 후 반영되는 경우를 가정.", ["reservation", "change-request"], ["FORM", "BUTTON"], ["변경 가능한 항목과 마감 시점을 정한다.", "매장 승인 전 기존 예약 상태를 정한다."]),
  candidate("RR-010", "예약 취소 요청", "예약자가 기존 예약의 취소를 요청한다.", 140_000, "취소 사유 선택과 요청 결과 표시를 구현.", "취소 요청과 실제 상태 변경을 구분하는 경우를 가정.", ["reservation", "cancel-request"], ["BUTTON", "PREVIEW"], ["취소 가능 시점과 예외를 정한다.", "매장 확인이 필요한 취소 상태를 정한다."]),
  candidate("RR-011", "대기 등록", "희망 시간에 예약할 수 없을 때 대기를 신청한다.", 180_000, "대기 요청 입력과 접수 결과 표시를 구현.", "대기 접수 조건이 별도 설정되는 경우를 가정.", ["waitlist", "reservation"], ["FORM", "TEXT"], ["대기 접수 가능 시간과 인원 기준을 정한다.", "대기 요청을 자동 만료할지 정한다."]),
  candidate("RR-012", "대기 목록 관리", "직원이 대기 요청을 조회하고 상태를 관리한다.", 210_000, "직원용 대기 목록과 상태 변경 동작을 구현.", "직원이 대기 순서를 직접 관리하는 경우를 가정.", ["admin", "waitlist"], ["LIST", "BUTTON"], ["대기 순서와 우선순위 기준을 정한다.", "예약 가능 시 연락 절차를 정한다."]),
  candidate("RR-013", "영업 시간 설정", "직원이 요일별 영업 시간을 등록한다.", 190_000, "요일별 영업 시간 입력과 검증을 구현.", "영업 시간대가 로컬 매장 시간으로 관리되는 경우를 가정.", ["admin", "business-hours"], ["FORM", "CALENDAR"], ["요일별 휴게 시간 입력 방식을 정한다.", "자정 이후 영업 시간 표현 방식을 정한다."]),
  candidate("RR-014", "예약 접수 시간대 관리", "직원이 예약을 받을 시간대를 관리한다.", 220_000, "예약 접수 시간대 조회와 편집을 구현.", "영업 시간과 예약 접수 시간이 다를 수 있다고 가정.", ["admin", "timeslot"], ["CALENDAR", "FORM"], ["예약 접수 간격과 마감 기준을 정한다.", "시간대별 접수 중단 방법을 정한다."]),
  candidate("RR-015", "시간대별 수용 인원 설정", "직원이 시간대별 예약 가능 인원을 설정한다.", 160_000, "시간대별 수용 인원 입력과 기본 검증을 구현.", "인원 기준으로 예약을 제한하는 경우를 가정.", ["admin", "capacity"], ["FORM"], ["인원 수를 테이블 수와 연결할지 정한다.", "수용 인원 변경의 기존 예약 영향을 정한다."]),
  candidate("RR-016", "휴무일 관리", "직원이 정기·임시 휴무일을 관리한다.", 160_000, "휴무일 달력 표시와 편집을 구현.", "정기 휴무와 임시 휴무를 구분하는 경우를 가정.", ["admin", "calendar"], ["CALENDAR", "BUTTON"], ["정기 휴무 반복 주기를 정한다.", "휴무일 변경 시 기존 예약 처리 방식을 정한다."]),
  candidate("RR-017", "예약 이용 시간 설정", "직원이 예약 한 건의 기본 이용 시간을 설정한다.", 130_000, "기본 이용 시간 입력과 표시를 구현.", "모든 예약에 공통 이용 시간을 적용하는 경우를 가정.", ["admin", "duration"], ["FORM"], ["이용 시간의 기본값과 단위를 정한다.", "시간대별로 다른 이용 시간을 허용할지 정한다."]),
  candidate("RR-018", "예약 마감 기준 설정", "직원이 예약 가능 시작·마감 시점을 설정한다.", 130_000, "예약 접수 마감 기준 입력과 검증을 구현.", "매장 운영 정책이 제공되는 경우를 가정.", ["admin", "booking-policy"], ["FORM", "TEXT"], ["당일 예약 허용 여부와 마감 시점을 정한다.", "마감 기준의 시간대를 정한다."]),
  candidate("RR-019", "좌석 선호 요청", "예약자가 좌석 또는 구역 선호를 전달한다.", 150_000, "좌석 선호 선택과 요청 전달을 구현.", "선호는 확약이 아닌 요청으로 처리하는 경우를 가정.", ["reservation", "seating"], ["FORM", "TEXT"], ["선택 가능한 구역과 좌석 유형을 정한다.", "선호 미충족 시 안내 문구를 정한다."]),
  candidate("RR-020", "테이블 배정 관리", "직원이 예약에 테이블을 배정한다.", 230_000, "예약별 테이블 배정과 충돌 표시를 구현.", "테이블 정보가 별도 등록되는 경우를 가정.", ["admin", "table-assignment"], ["LIST", "BUTTON"], ["테이블 배정 규칙과 수동 변경 권한을 정한다.", "겹치는 시간 예약의 판단 기준을 정한다."]),
  candidate("RR-021", "예약 현황 달력", "직원이 날짜별 예약 현황을 달력으로 확인한다.", 200_000, "직원용 예약 달력과 상태 표시를 구현.", "단일 매장의 일·주 단위 보기를 가정.", ["admin", "calendar"], ["CALENDAR", "LIST"], ["기본 보기 단위와 예약 표시 규칙을 정한다.", "달력에서 편집할 수 있는 범위를 정한다."]),
  candidate("RR-022", "방문 체크인 처리", "직원이 도착한 예약의 방문 상태를 기록한다.", 130_000, "예약 도착 확인과 상태 표시를 구현.", "직원이 직접 체크인하는 경우를 가정.", ["admin", "check-in"], ["LIST", "BUTTON"], ["체크인 허용 시점과 되돌리기 권한을 정한다.", "워크인 방문과 구분하는 방식을 정한다."]),
  candidate("RR-023", "도착 지연 기록", "직원이 예약자의 지연 상황을 기록한다.", 120_000, "지연 상태와 직원 메모 입력을 구현.", "지연 기록은 안내·상태 확인용으로만 사용한다고 가정.", ["admin", "arrival"], ["FORM", "BUTTON"], ["지연 상태의 종료 기준을 정한다.", "지연 기록 보관 기간을 정한다."]),
  candidate("RR-024", "예약 상태 변경", "권한이 있는 직원이 예약 상태를 변경한다.", 150_000, "예약 상태 변경 동작과 결과 표시를 구현.", "상태 목록과 전이 규칙이 제공되는 경우를 가정.", ["admin", "reservation-status"], ["LIST", "BUTTON"], ["상태 전이와 변경 사유 필요 여부를 정한다.", "변경 이력의 보관 범위를 정한다."]),
  candidate("RR-025", "단체 예약 접수", "예약자가 많은 인원의 예약을 요청한다.", 220_000, "단체 예약 정보 입력과 요청 접수를 구현.", "기준 인원 이상은 확정 전 확인하는 경우를 가정.", ["reservation", "group-booking"], ["FORM", "PREVIEW"], ["단체 예약 기준 인원과 확인 절차를 정한다.", "일반 예약과 다른 필수 정보를 정한다."]),
  candidate("RR-026", "추가 요청사항 입력", "예약자가 식사 관련 요청사항을 전달한다.", 160_000, "선택 입력과 직원 확인 화면을 구현.", "요청사항은 예약 확약이 아닌 전달 메모로 처리한다고 가정.", ["reservation", "guest-request"], ["FORM", "TEXT"], ["수집 가능한 요청 유형과 제한을 정한다.", "건강 관련 정보의 취급과 보관을 정한다."]),
  candidate("RR-027", "매장 지점 선택", "예약자가 예약할 매장 지점을 선택한다.", 150_000, "지점 목록 표시와 선택 상태를 구현.", "복수 지점 운영이 필요한 경우에만 적용한다고 가정.", ["reservation", "branch"], ["LIST", "BUTTON"], ["지점별 예약 일정 분리 기준을 정한다.", "지점 간 예약자 정보 공유 범위를 정한다."]),
  candidate("RR-028", "당일 예약 현황 요약", "직원이 당일 예약 건수와 시간대별 현황을 본다.", 200_000, "당일 예약 요약과 시간대별 분포를 구현.", "기존 예약 데이터만 집계하는 경우를 가정.", ["admin", "dashboard"], ["TEXT", "LIST"], ["요약 지표와 새로고침 시점을 정한다.", "취소·대기 건의 집계 방식을 정한다."]),
  candidate("RR-029", "예약 검색 및 필터", "직원이 조건에 맞는 예약을 검색한다.", 140_000, "예약 목록 검색과 상태 필터를 구현.", "직원 권한으로 허용된 필드만 검색한다고 가정.", ["admin", "search"], ["FORM", "LIST"], ["검색 가능한 항목과 기간을 정한다.", "개인정보 검색 결과의 마스킹 범위를 정한다."]),
  candidate("RR-030", "예약 안내 문구 관리", "직원이 예약 화면에 표시할 안내를 관리한다.", 170_000, "예약 전 안내 문구 편집과 미리보기를 구현.", "문구는 정보 제공용이며 별도 약관 승인을 대체하지 않는다고 가정.", ["admin", "copy"], ["TEXT", "PREVIEW"], ["노출 위치별 문구와 글자 제한을 정한다.", "안내 문구 수정 이력을 보관할지 정한다."]),
  candidate("RR-031", "직원 확인 후 예약 확정", "매장이 요청을 검토한 뒤 예약 상태를 결정한다.", 170_000, "직원 검토 대기와 확인 결과 표시를 구현.", "요청형 예약이 필요한 매장에 선택 적용한다고 가정.", ["admin", "approval"], ["LIST", "BUTTON"], ["응답 기한과 미응답 처리 방식을 정한다.", "승인·거절 사유를 예약자에게 보일지 정한다."]),
  candidate("RR-032", "당일 예약 접수 제한", "직원이 당일 예약의 접수 허용 여부를 설정한다.", 140_000, "당일 접수 정책 입력과 예약 화면 반영을 구현.", "예약 마감 정책이 별도로 합의되는 경우를 가정.", ["admin", "same-day"], ["FORM", "TEXT"], ["당일 접수 마감 시각과 예외를 정한다.", "이미 시작된 시간대의 표시 방식을 정한다."]),
  candidate("RR-033", "최소 예약 인원 설정", "직원이 예약 가능한 최소 인원을 설정한다.", 140_000, "최소 인원 입력과 예약 화면 검증을 구현.", "매장별 인원 기준이 제공되는 경우를 가정.", ["admin", "party-size"], ["FORM"], ["최소 인원 기준 적용 대상을 정한다.", "기준 미달 문의 접수 방식을 정한다."]),
  candidate("RR-034", "최대 예약 인원 설정", "직원이 예약 가능한 최대 인원을 설정한다.", 140_000, "최대 인원 입력과 예약 화면 검증을 구현.", "매장별 인원 기준이 제공되는 경우를 가정.", ["admin", "party-size"], ["FORM"], ["최대 인원 기준 적용 대상을 정한다.", "기준 초과 문의 접수 방식을 정한다."]),
  candidate("RR-035", "직원용 예약 메모", "권한이 있는 직원이 예약에 내부 메모를 남긴다.", 150_000, "예약별 내부 메모 입력과 권한 확인을 구현.", "메모는 직원에게만 보이고 민감 정보를 넣지 않도록 제한한다고 가정.", ["admin", "reservation-note"], ["FORM", "PREVIEW"], ["메모 작성·조회 권한을 정한다.", "메모의 민감정보 제한과 삭제 기한을 정한다."]),
  candidate("RR-036", "대기 진행 상태 안내", "대기자가 자신의 요청 처리 상태를 확인한다.", 160_000, "대기 상태 표시와 다음 단계 안내를 구현.", "순번이 확정 순서를 보장하지 않는 경우를 가정.", ["waitlist", "status"], ["TEXT", "PREVIEW"], ["대기 순번을 공개할지 정한다.", "상태 변경을 알리는 방법과 시점을 정한다."]),
];

// D-07 candidates stay inactive until the product owner reviews and approves them.
export const reservationRestaurantSeedBlocks: Prisma.BlockCatalogCreateManyInput[] = candidates.map((block, index) => ({
  ...block,
  industryCode: reservationRestaurantIndustryCode,
  source: BlockSource.TEAM,
  isDrawable: true,
  inDefaultDraft: index < 6,
  recommendRank: index + 1,
  reviewedAt: null,
  isActive: false,
  sortOrder: index + 1,
}));

export function seedReservationRestaurantCatalog(db: PrismaClient): Promise<number> {
  return seedBlockCatalog(db, reservationRestaurantSeedBlocks);
}
