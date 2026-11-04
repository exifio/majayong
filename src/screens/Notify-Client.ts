import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

// [그룹, 아이콘, 색, 메시지, 프로젝트 · 보조, 시각, 안 읽음, 이동 화면, 이동 이름]
type NotifyRow = [string, string, string, string, string, string, boolean, string, string];

/** 의뢰인 — 알림 (드롭다운) */
export default class NotifyClientScreen extends Screen {
  static override readonly id = "Notify-Client";
  static override readonly title = "의뢰인 — 알림 (드롭다운)";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["안 읽음 있음", "모두 읽음", "기한 알림"], "default": "안 읽음 있음", "section": "상태"}};


  renderVals(): Values {
    const sup = ('의뢰인' as string) === '공급자';
    const allRead = (this.props.view ?? '안 읽음 있음') === '모두 읽음';
    const I: Record<string, string> = {
      msg: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
      doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
      check: 'M20 6 9 17l-5-5',
      x: 'M18 6 6 18M6 6l12 12',
      clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
      redo: 'M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5',
      cut: 'M5.6 5.6l12.8 12.8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'
    };
    // [그룹, 아이콘, 색, 메시지, 프로젝트 · 보조, 시각, 안 읽음, 이동 화면, 이동 이름]
    const C: NotifyRow[] = [
      ['오늘', 'check', 'teal', '1:1 문의에 답변이 왔습니다', '예치했는데 내 계약에 확인 중으로 나와요 · 마자용 운영팀', '15:02', true, 'Help-Inquiry.dc.html', '내 문의'],
      ['오늘', 'msg', 'blue', '최준호님의 새 메시지 1개', '예약 달력, 예약금 결제 외 2개 기능 · 견적을 3,100,000원으로 고쳤다는 안내', '14:21', true, 'Chat-Client.dc.html', '채팅'],
      ['오늘', 'doc', 'blue', '스튜디오 넛이 지원했습니다', '예약 달력, 예약금 결제 외 2개 기능 · 지원 3건째', '09:15', true, 'Compare-Client.dc.html', '제안 비교'],
      ['어제', 'cut', 'amber', '김세라님과의 임시 계약이 결렬되었습니다 — 7일 안에 서명이 없었습니다', '포장 주문 접수 외 1개 기능 · 예치 전이라 오간 금액은 없습니다', '18:00', true, 'Contracts-Client.dc.html', '내 계약'],
      ['이번 주', 'doc', '', '김세라님이 지원했습니다', '예약 달력, 예약금 결제 외 2개 기능 · 지원 2건째', '10월 30일', false, 'Compare-Client.dc.html', '제안 비교'],
      ['이번 주', 'doc', '', '최준호님이 지원했습니다', '예약 달력, 예약금 결제 외 2개 기능 · 첫 지원', '10월 29일', false, 'Compare-Client.dc.html', '제안 비교']
    ];
    const S: NotifyRow[] = [
      ['오늘', 'check', 'teal', '선택되었습니다 — 11월 10일까지 계약서에 서명해 주세요', '온도 다이닝 · 예약 달력, 예약금 결제 외 2개 기능 · 임시 계약', '09:30', true, 'Apps-Supplier.dc.html', '내 지원'],
      ['오늘', 'msg', 'blue', '정민재님의 새 메시지 2개', '온도 다이닝 · "예약금은 1인 3만 원으로 생각하고 있어요"', '09:05', true, 'Chat-Supplier.dc.html', '채팅'],
      ['오늘', 'redo', 'amber', '재견적 요청 — 의뢰인이 명세를 고쳤습니다', '라운드 테이블 · 좌석 배치도, 코스 메뉴 선택 외 3개 기능 · 이전 견적은 이전 명세 기준', '08:10', true, 'QuoteWrite-Supplier.dc.html', '다시 견적 내기'],
      ['어제', 'clock', '', '모집이 마감되었습니다 — 의뢰인이 지원자 중에서 고르는 중입니다', '담소 키친 · 회차 예약, 알레르기 사전 접수 외 2개 기능', '18:00', false, 'Apps-Supplier.dc.html', '내 지원'],
      ['어제', 'x', '', '지원이 거절되었습니다 — 의뢰인이 다른 공급자와 계약했습니다', '면옥 · 전화 예약 대체, 대기 명단 외 1개 기능 · 자동 거절 · 채팅은 읽기 전용', '15:20', false, 'Apps-Supplier.dc.html', '내 지원'],
      ['이번 주', 'x', '', '의뢰인이 지원을 거절했습니다', '하루 베이커리 · 픽업 주문, 적립 쿠폰 외 1개 기능 · 직접 거절', '10월 30일', false, 'Apps-Supplier.dc.html', '내 지원'],
      ['이번 주', 'cut', '', '임시 계약이 결렬되었습니다 — 7일 안에 양측 서명이 없었습니다', '공방 결 · 클래스 예약, 수강권 결제 외 1개 기능 · 지원은 거절 처리', '10월 28일', false, 'Apps-Supplier.dc.html', '내 지원']
    ];
    const CD: NotifyRow[] = [
      ['기한 안내', 'clock', 'amber', '작업 마감이 지났습니다 — 최종 구간이 아직 납품되지 않았습니다', '예약 달력, 예약금 결제 외 2개 기능 · 마감 12월 16일 · 채팅으로 일정을 정하거나 계약 취소를 요청할 수 있습니다', '12월 17일', true, 'Contracts-Client.dc.html', '내 계약'],
      ['기한 안내', 'clock', 'amber', '검수 기한이 내일입니다 — 승인하거나 보완을 요청해 주세요', '예약 달력, 예약금 결제 외 2개 기능 · 중간 구간 · 12월 2일이 지나면 자동 승인되고 지급됩니다', '12월 1일', true, 'Inspect-Client.dc.html', '검수'],
      ['기한 안내', 'clock', 'amber', '예치 기한이 내일입니다 — 대금을 예치해 주세요', '예약 달력, 예약금 결제 외 2개 기능 · 11월 7일 23:59가 지나면 임시 계약이 자동 결렬됩니다', '11월 6일', false, 'Escrow-Client.dc.html', '결제'],
      ['기한이 지나 처리됨', 'check', 'teal', '검수 기한이 지나 자동 승인되었습니다', '예약 달력, 예약금 결제 외 2개 기능 · 최종 구간 1,550,000원이 공급자에게 지급됩니다', '12월 20일', false, 'Settle-Client.dc.html', '결제 · 정산'],
      ['기한이 지나 처리됨', 'cut', '', '예치 기한이 지나 임시 계약이 결렬되었습니다', '예약 달력, 예약금 결제 외 2개 기능 · 보류했던 지원자 중에서 다시 고를 수 있습니다', '11월 8일', false, 'Contracts-Client.dc.html', '내 계약']
    ];
    const SD: NotifyRow[] = [
      ['기한 안내', 'clock', 'amber', '작업 마감이 지났습니다 — 납품하거나 의뢰인과 일정을 정하세요', '온도 다이닝 · 예약 달력, 예약금 결제 외 2개 기능 · 마감 12월 16일 · 최종 구간 미납', '12월 17일', true, 'Deliver-Supplier.dc.html', '납품'],
      ['기한 안내', 'clock', 'amber', '작업 마감이 내일입니다', '온도 다이닝 · 예약 달력, 예약금 결제 외 2개 기능 · 12월 16일까지 최종 구간을 납품해 주세요', '12월 15일', true, 'Deliver-Supplier.dc.html', '납품'],
      ['기한이 지나 처리됨', 'check', 'teal', '검수 기한이 지나 자동 승인되었습니다 — 지급 예정', '온도 다이닝 · 예약 달력, 예약금 결제 외 2개 기능 · 최종 구간 1,472,500원(수수료 뺀 금액)', '12월 20일', false, 'Settle-Supplier.dc.html', '정산 내역'],
      ['기한이 지나 처리됨', 'cut', '', '의뢰인이 예치 기한까지 예치하지 않아 임시 계약이 결렬되었습니다', '온도 다이닝 · 예약 달력, 예약금 결제 외 2개 기능 · 이 지원은 거절로 처리됩니다', '11월 8일', false, 'Contracts-Supplier.dc.html', '내 계약']
    ];
    const dl = (this.props.view ?? '안 읽음 있음') === '기한 알림';
    const src = dl ? (sup ? SD : CD) : (sup ? S : C);
    let nUn = 0;
    const order = [...new Set(src.map(r => r[0]))];
    const groups = order.map(lbl => {
      const rows = src.filter(r => r[0] === lbl).map((r, i) => {
        const un = r[6] && !allRead;
        if (un) nUn++;
        return { cls: 'nr' + (i === 0 ? ' first' : '') + (un ? ' un' : ''), href: r[7], icCls: 'ic' + (r[2] ? ' ' + r[2] : ''), icon: I[r[1]],
          msg: r[3], sub: r[4], time: r[5], un: un, go: r[8] };
      });
      return { label: lbl, rows: rows };
    }).filter(g => g.rows.length);
    return {
      isClient: !sup, isSupplier: sup, groups: groups, nAll: src.length, nUn: nUn,
      bellCls: 'bell open' + (nUn ? ' dot' : ''), hasUn: nUn > 0, allCls: 'allread' + (nUn ? '' : ' off'),
      sub: nUn ? '읽지 않은 알림이 ' + nUn + '건 있습니다. 누르면 그 화면으로 이동합니다.' : '모든 알림을 읽었습니다. 누르면 그 화면으로 이동합니다.'
    };
  }
}
