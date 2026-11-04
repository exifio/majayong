import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 프로젝트 찾기 */
export default class FindSupplierScreen extends Screen {
  static override readonly id = "Find-Supplier";
  static override readonly title = "공급자 — 프로젝트 찾기";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["전체", "북마크", "검색 결과 없음"], "default": "전체", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '전체';
    const bm = v === '북마크', empty = v === '검색 결과 없음';
    const mine = ['React', 'Next.js', 'Supabase'];
    // [업종, 제목, 항목 이름들, 예산 구간, 마감 문구, 마감 임박, 스택, 북마크, 마감됨]
    type Row = [string, string, string, string, string, boolean, string[], boolean, boolean];
    const P: Row[] = [
      ['음식점', '예약 달력, 예약금 결제 외 2개 기능', '예약 달력 · 예약금 결제 · 노쇼 기록 · 리마인드 알림', '400~500만원', '마감 11월 3일 · 2일 남음', true, ['React', 'Supabase'], true, false],
      ['음식점', '회차 예약, 알레르기 사전 접수 외 2개 기능', '회차 예약 · 알레르기 사전 접수 · 코스 안내 · 예약 확인 문자', '200~300만원', '마감 11월 9일', false, ['React', 'Supabase'], false, false],
      ['카페 · 베이커리', '픽업 주문, 적립 쿠폰 외 1개 기능', '픽업 주문 · 적립 쿠폰 · 영업시간 안내', '100~200만원', '마감 11월 12일', false, ['Next.js'], false, false],
      ['음식점', '좌석 배치도, 코스 메뉴 선택 외 3개 기능', '좌석 배치도 · 코스 메뉴 선택 · 단체 예약 · 대기 등록 · 리뷰 모음', '300~400만원', '마감 11월 21일', false, ['Vue', 'Firebase'], true, false],
      ['미용 · 뷰티', '디자이너별 예약, 시술 사진 갤러리 외 2개 기능', '디자이너별 예약 · 시술 사진 갤러리 · 예약금 결제 · 리마인드 알림', '200~300만원', '마감 11월 14일', false, ['React'], false, false],
      ['학원 · 교육', '수강 신청, 출결 알림 외 1개 기능', '수강 신청 · 출결 알림 · 공지 게시판', '300~400만원', '마감 11월 18일', false, ['Next.js', 'Supabase'], false, false],
      ['음식점', '테이블 오더, 메뉴판 관리 외 1개 기능', '테이블 오더 · 메뉴판 관리 · 주방 알림', '200~300만원', '마감 11월 25일', false, ['React', 'Node.js'], false, false],
      ['카페 · 베이커리', '정기 구독, 원두 주문 외 2개 기능', '정기 구독 · 원두 주문 · 배송 조회 · 적립 쿠폰', '300~400만원', '마감 11월 28일', false, ['Next.js'], false, false],
      ['음식점', '단골 등급 관리, 재방문 알림 외 1개 기능', '단골 등급 관리 · 재방문 알림 · 쿠폰 발송', '100~200만원', '마감 11월 14일', false, ['Next.js'], false, false],
      ['숙박', '객실 예약, 후기 모음 외 2개 기능', '객실 예약 · 후기 모음 · 체크인 안내 · 부가 서비스', '400~500만원', '10월 30일 마감', false, ['React'], true, true]
    ];
    const row = (p: Row) => ({
      cat: p[0], title: p[1], items: p[2], n: p[2].split(' · ').length, budget: p[3], dl: p[4],
      dlCls: 'dl' + (p[5] ? ' soon' : ''), closed: p[8], cls: 'pc' + (p[8] ? ' closed' : ''),
      stack: p[6].map(s => ({ name: s, cls: 'tag' + (mine.includes(s) ? ' on' : '') })),
      bmCls: 'bm' + (p[7] ? ' on' : ''), bmFill: p[7] ? 'currentColor' : 'none', bmPressed: p[7] ? 'true' : 'false',
      btn: p[8] ? '명세 보기' : '명세 열어보기', btnCls: p[8] ? 'btn sm gh' : 'btn sm tint'
    });
    let rows = P.map(row);
    if (bm) rows = P.filter(p => p[7]).map(row);
    if (empty) rows = [];
    return {
      isFind: !bm, isEmpty: empty, hasRows: !empty, rows: rows,
      layCls: bm ? 'lay one' : 'lay',
      navFind: bm ? '' : 'on', navBm: bm ? 'on' : '',
      title: bm ? '북마크' : '프로젝트 찾기',
      sub: bm ? '명세 상세에서 북마크한 프로젝트입니다. 모집이 끝난 프로젝트도 마감 표시로 남습니다.'
              : '목록에는 업종 · 기능 이름 · 항목 수 · 희망 예산 구간 · 마감일만 보입니다. 기능 설명과 의뢰인 정보는 명세를 열면 보이고, 열람 기록이 남습니다.',
      q: empty ? '키오스크 연동' : '',
      countText: bm ? '북마크 3건 · 모집 중 2 · 마감 1' : (empty ? '검색 결과 0건' : '23건 중 1–10'),
      foot: bm ? '북마크는 프로젝트 상세의 북마크 버튼으로 켜고 끕니다.' : '한 쪽에 10건씩 보여 드립니다. 파란 테두리 기술 스택은 프로필에 등록하신 것과 같은 스택입니다. 희망 예산은 구간으로만 보이고, 정확한 금액은 명세 상세에 있습니다.'
    };
  }
}
