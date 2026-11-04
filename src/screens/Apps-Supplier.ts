import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 내 지원 현황 */
export default class AppsSupplierScreen extends Screen {
  static override readonly id = "Apps-Supplier";
  static override readonly title = "공급자 — 내 지원 현황";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["전체", "선택됨(서명 대기)", "보류 중", "지원 철회 확인", "제출 완료"], "default": "전체", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '전체';
    const wd = v === '지원 철회 확인';
    const sent = v === '제출 완료';
    const picked = v === '선택됨(서명 대기)', held = v === '보류 중' || wd;
    const base = (o: Values) => Object.assign({ cls: 'pj', chipCls: 'chip', hasNote: false, ntCls: 'nt', note: '', hasTx: false, tx: '',
      hasLink: false, link: '', linkHref: '#', hasBtn: true, btnCls: 'btn sm tint', href: '#', action: '', unread: '', expand: false,
      amtLabel: '내 견적 · 1회차' }, o);
    const ondo = picked
      ? base({ chip: '임시 계약 · 서명 대기', chipCls: 'chip amber', when: '서명 기한 11월 10일 · D-7',
          title: '예약 달력, 예약금 결제 외 2개 기능', client: '온도 다이닝 · 음식점(코스 레스토랑)', applied: '10월 29일 지원',
          amtLabel: '합의 금액 · 2회차', amount: '3,100,000원', amtSub: '42일 · 예상 수령 2,945,000원',
          hasNote: true, note: '임시 계약 중에는 견적을 고칠 수 없습니다. 위 카드에서 계약서를 확인하고 서명해 주세요.',
          hasLink: true, link: '채팅 보기', linkHref: 'Chat-Supplier.dc.html', href: 'Contract-Supplier.dc.html', action: '계약서 보기' })
      : base({ chip: '문의 중', chipCls: 'chip blue', when: '마감 11월 3일',
          title: '예약 달력, 예약금 결제 외 2개 기능', client: '온도 다이닝 · 음식점(코스 레스토랑)', applied: '10월 29일 지원',
          amtLabel: '내 견적 · 2회차', amount: '3,100,000원', amtSub: '42일 · 예상 수령 2,945,000원',
          hasNote: true, note: '11월 1일 채팅에서 견적을 고쳤습니다(1회차 3,000,000원 → 대체됨). 새 메시지 1건이 있습니다.',
          hasLink: true, link: '견적 보기', linkHref: 'QuoteView-Supplier.dc.html', href: 'Chat-Supplier.dc.html', action: '채팅 보기', unread: 1 });
    const review = base({ chip: '문의 중', chipCls: 'chip blue', when: '마감 11월 9일',
      title: '회차 예약, 알레르기 사전 접수 외 2개 기능', client: '담소 키친 · 음식점(한식 주점)', applied: '10월 31일 지원',
      amount: '2,400,000원', amtSub: '35일 · 예상 수령 2,280,000원',
      hasNote: true, note: '의뢰인이 11월 1일 문의 채팅을 열었습니다. 정할 것은 채팅에서 함께 정합니다.',
      hasLink: true, link: '견적 보기', linkHref: 'QuoteView-Supplier.dc.html', href: 'Chat-Supplier.dc.html', action: '채팅 보기' });
    const requote = base({ chip: '재견적 요청', chipCls: 'chip amber', when: '마감 11월 21일',
      title: '좌석 배치도, 코스 메뉴 선택 외 3개 기능', client: '라운드 테이블 · 음식점(와인 바)', applied: '10월 27일 지원',
      amount: '3,600,000원', amtSub: '이전 명세 기준 · 선택될 수 없음',
      hasNote: true, ntCls: 'nt am', note: '11월 2일 의뢰인이 명세를 고쳤습니다. 지금 견적으로는 선택될 수 없으니 바뀐 항목을 보고 다시 내 주세요.',
      href: 'QuoteWrite-Supplier.dc.html', action: '다시 견적 내기' });
    const hold = base({ cls: held ? 'pj held' : 'pj', chip: '보류', chipCls: 'chip out', when: '다른 공급자 서명 기한 11월 10일',
      title: '단골 등급 관리, 재방문 알림 외 1개 기능', client: '브루잉 랩 · 카페', applied: '10월 25일 지원',
      amount: '1,800,000원', amtSub: '28일 · 예상 수령 1,710,000원',
      hasNote: !held, note: '의뢰인이 다른 공급자와 계약을 진행 중입니다(예치 전). 결렬되면 다시 선택될 수 있습니다.',
      hasTx: true, tx: '지원 철회', btnCls: 'btn sm gh', href: 'Chat-Supplier.dc.html', action: '채팅 보기', expand: held });
    let rows = held ? [hold] : [ondo, review, requote, hold];
    if (sent) {
      rows.length = 0;
      rows.push(base({ cls: 'pj newr', chip: '검토 중', when: '방금 제출 · 마감 11월 3일',
        title: '예약 달력, 예약금 결제 외 2개 기능', client: '온도 다이닝 · 음식점(코스 레스토랑)', applied: '10월 29일 지원',
        amount: '3,000,000원', amtSub: '42일 · 예상 수령 2,850,000원',
        hasNote: true, note: '의뢰인에게 묻고 싶은 것 2개를 함께 보냈습니다. 의뢰인이 문의 채팅을 열면 답을 받을 수 있습니다.',
        hasLink: true, link: '프로젝트 보기', linkHref: 'Project-Supplier.dc.html', btnCls: 'btn sm gh', href: 'QuoteView-Supplier.dc.html', action: '보낸 견적 보기' }),
        Object.assign({}, requote, { chip: '검토 중', chipCls: 'chip', ntCls: 'nt', amtSub: '30일 · 예상 수령 3,420,000원', note: '의뢰인이 아직 문의하지 않았습니다.', btnCls: 'btn sm gh', href: 'QuoteView-Supplier.dc.html', action: '견적 보기' }),
        Object.assign({}, hold, { cls: 'pj', chip: '검토 중', chipCls: 'chip', when: '마감 11월 5일', hasNote: true, note: '의뢰인이 아직 문의하지 않았습니다.', hasTx: false, expand: false, href: 'QuoteView-Supplier.dc.html', action: '견적 보기' }));
    }
    const ended = [
      { chip: '자동 거절', chipCls: 'chip out', when: '10월 30일', title: '전화 예약 대체, 대기 명단 외 1개 기능', client: '하루 베이커리 · 베이커리', applied: '10월 18일 지원',
        amtLabel: '내 견적 · 1회차', amount: '1,500,000원', amtSub: '21일',
        note: '의뢰인이 다른 공급자와 계약하고 예치를 마쳐 자동으로 거절되었습니다. 채팅은 읽기 전용입니다.', href: 'Chat-Supplier.dc.html', action: '채팅 보기' },
      { chip: '직접 거절', chipCls: 'chip out', when: '10월 22일', title: '포장 주문, 픽업 시간 선택 외 2개 기능', client: '면옥 · 음식점(냉면)', applied: '10월 15일 지원',
        amtLabel: '내 견적 · 1회차', amount: '2,200,000원', amtSub: '30일',
        note: '의뢰인이 견적을 거절했습니다.', href: 'Project-Supplier.dc.html', action: '프로젝트 보기' },
      { chip: '결렬', chipCls: 'chip out', when: '10월 12일', title: '클래스 예약, 수강권 결제 외 1개 기능', client: '공방 결 · 공방', applied: '9월 28일 지원',
        amtLabel: '합의 금액', amount: '1,900,000원', amtSub: '임시 계약 · 7일 안에 서명 없음',
        note: '서명 기한 7일이 지나 결렬되었습니다. 이 지원은 거절로 처리되었습니다.', href: 'Chat-Supplier.dc.html', action: '채팅 보기' }
    ];
    if (sent) ended.shift();
    const T = sent ? [['전체', 5], ['검토 중', 3], ['문의 중', 0], ['선택됨', 0], ['보류', 0], ['종료', 2]] : [['전체', 7], ['검토 중', 1], ['문의 중', picked ? 1 : 2], ['선택됨', picked ? 1 : 0], ['보류', 1], ['종료', 3]];
    const tabHref: Record<string, string> = { '전체': '?view=전체', '보류': '?view=보류+중' };
    const tabs = T.map(t => ({ name: t[0], n: t[1], cls: (held ? t[0] === '보류' : t[0] === '전체') ? 'on' : '', href: tabHref[t[0] as string] ?? '#apps' }));
    return { sent: sent, picked: picked, rows: rows, ended: ended, showEnded: !held, tabs: tabs, wdOpen: wd };
  }
}
