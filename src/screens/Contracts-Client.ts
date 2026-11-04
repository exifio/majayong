import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 내 계약 */
export default class ContractsClientScreen extends Screen {
  static override readonly id = "Contracts-Client";
  static override readonly title = "의뢰인 — 내 계약";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["서명 대기", "예치 대기", "진행 중", "검수 대기", "완료", "취소 요청 중", "결렬 — 예치 기한 초과", "마감 지남"], "default": "진행 중", "section": "상태"}};


  renderVals(): Values {
    const role = '의뢰인';
    const view = this.props.view ?? '진행 중';
    const cl = role === '의뢰인';
    const sign = view === '서명 대기', done = view === '완료', act = view === '진행 중', esc = view === '예치 대기', insp = view === '검수 대기', cx = view === '취소 요청 중', lapse = view === '결렬 — 예치 기한 초과', late = view === '마감 지남';

    // 단계: 서명 → 예치 → 중간 검수 · 지급 → 최종 검수 · 지급 → 완료
    const S = (st: string[], subs: string[]) => ['서명', '예치', '중간 검수 · 지급', '최종 검수 · 지급', '완료'].map((n, i) => ({ name: n, cls: st[i], sub: subs[i] }));
    let steps, segs, chip, chipCls, dd, ddCls, todo, actLabel, actHref, actCls, hasAct = true, actOff = false, cardCls = 'ck', ln = '';
    const it = (a: [string, string], b: [string, string]) => [{ text: a[0], cls: a[1], sep: ' · ' }, { text: b[0], cls: b[1], sep: '' }];
    if (sign) {
      steps = S(['now', 'todo', 'todo', 'todo', 'todo'], [cl ? '내 서명 전 · 공급자 서명 전' : '내 서명 전 · 의뢰인 서명 전', '서명 후', '', '', '']);
      segs = [
        { name: '중간 구간', chip: '시작 전', chipCls: 'chip out', items: it(['예약 달력', ''], ['예약금 결제', '']), amtLabel: '구간 금액', amt: '1,550,000원', pay: '중간 항목이 모두 승인되면 지급' },
        { name: '최종 구간', chip: '시작 전', chipCls: 'chip out', items: it(['노쇼 기록', ''], ['리마인드 알림', '']), amtLabel: '구간 금액', amt: '1,550,000원', pay: '최종 항목이 모두 승인되면 지급' }
      ];
      chip = '임시 계약 · 서명 대기'; chipCls = 'chip amber'; dd = '서명 기한 11월 10일 · D-7'; ddCls = 'dd soon';
      todo = cl ? '계약서를 확인하고 서명해 주세요. 두 분이 모두 서명하면 계약이 체결되고 예치로 넘어갑니다.'
                : '계약서를 확인하고 서명해 주세요. 기한 안에 서명하지 않거나 거절하면 결렬됩니다.';
      actLabel = cl ? '서명하기' : '계약서 확인하고 서명'; actHref = 'Contract-Client.dc.html'; actCls = 'btn sm tint';
      cardCls = 'ck now2';
    } else if (esc) {
      steps = S(['done', 'now', 'todo', 'todo', 'todo'], ['11월 4일 · 양측 서명', '예치 전 · 11월 7일까지', '', '', '']);
      segs = [
        { name: '중간 구간', chip: '시작 전', chipCls: 'chip out', items: it(['예약 달력', ''], ['예약금 결제', '']), amtLabel: '구간 금액', amt: '1,550,000원', pay: '중간 항목이 모두 승인되면 지급' },
        { name: '최종 구간', chip: '시작 전', chipCls: 'chip out', items: it(['노쇼 기록', ''], ['리마인드 알림', '']), amtLabel: '구간 금액', amt: '1,550,000원', pay: '최종 항목이 모두 승인되면 지급' }
      ];
      chip = '계약 체결 · 예치 대기'; chipCls = 'chip amber'; dd = '11월 7일까지 예치 · 지나면 자동 결렬 · D-3'; ddCls = 'dd soon';
      if (cl) {
        todo = '계약이 체결되었습니다. 11월 7일까지 3,255,000원을 예치하면 공급자가 작업을 시작합니다. 기한이 지나면 자동으로 결렬됩니다.';
        actLabel = '예치하기'; actHref = 'Escrow-Client.dc.html'; actCls = 'btn sm tint';
      } else {
        todo = '의뢰인이 11월 7일까지 예치하면 작업 기간 42일이 시작됩니다. 기한이 지나면 자동으로 결렬됩니다.';
        actLabel = '납품하기'; actHref = 'Deliver-Supplier.dc.html'; hasAct = false; actOff = true;
      }
      cardCls = 'ck now2';
    } else if (insp) {
      steps = S(['done', 'done', 'now', 'todo', 'todo'], ['11월 4일', '11월 4일 · 3,255,000원', '11월 25일 납품 · 검수 중', '', '']);
      segs = [
        { name: '중간 구간', chip: '검수 대기', chipCls: 'chip amber', items: it(['예약 달력 납품', ''], ['예약금 결제 납품', '']), amtLabel: cl ? '지급 예정' : '받을 예정', amt: cl ? '1,550,000원' : '1,472,500원', pay: '두 항목이 모두 승인되면 지급' },
        { name: '최종 구간', chip: '작업 중', chipCls: 'chip blue', items: it(['노쇼 기록', ''], ['리마인드 알림', '']), amtLabel: cl ? '지급 예정' : '받을 예정', amt: cl ? '1,550,000원' : '1,472,500원', pay: '최종 항목이 모두 승인되면 지급' }
      ];
      chip = '진행 중 · 검수 대기'; chipCls = 'chip amber'; dd = '검수 기한 12월 2일 · 지나면 자동 승인 · D-7'; ddCls = 'dd soon';
      if (cl) {
        todo = '중간 납품 2건이 도착했습니다. 12월 2일까지 항목마다 승인하거나 보완을 요청해 주세요. 작업 마감은 12월 16일입니다.';
        actLabel = '검수하기'; actHref = 'Inspect-Client.dc.html'; actCls = 'btn sm tint';
      } else {
        todo = '의뢰인이 중간 납품 2건을 검수하고 있습니다. 보완 요청이 오면 그 항목만 다시 내면 됩니다.';
        actLabel = '납품 보기'; actHref = 'Deliver-Supplier.dc.html'; actCls = 'btn sm tint';
      }
      cardCls = 'ck now2';
    } else if (cx) {
      steps = S(['done', 'done', 'hold', 'todo', 'todo'], ['11월 4일', '11월 4일 · 3,255,000원', '취소 요청으로 멈춤', '', '']);
      segs = [
        { name: '중간 구간', chip: '작업 멈춤', chipCls: 'chip amber', items: it(['예약 달력', ''], ['예약금 결제', '']), amtLabel: cl ? '지급 전' : '받기 전', amt: cl ? '1,550,000원' : '1,472,500원', pay: '납품 전 · 취소 정산으로 처리' },
        { name: '최종 구간', chip: '시작 전', chipCls: 'chip out', items: it(['노쇼 기록', ''], ['리마인드 알림', '']), amtLabel: '구간 금액', amt: '1,550,000원', pay: '취소되면 전액 환불' }
      ];
      chip = cl ? '취소 요청 · 공급자 답 기다림' : '취소 요청 받음 · 답해 주세요'; chipCls = 'chip amber'; dd = '11월 8일 요청'; ddCls = 'dd soon';
      todo = cl ? '11월 8일 취소를 요청했습니다(의뢰인 사정). 최준호님이 사유에 동의하면 정산이 확정되고, 이견이면 운영자가 판정합니다. 그동안 작업과 검수는 멈춥니다.'
                : '온도 다이닝이 11월 8일 취소를 요청했습니다. 사유에 동의하거나 이견을 남겨 주세요. 그동안 작업과 검수는 멈춥니다.';
      actLabel = cl ? '요청 보기' : '요청 확인하기'; actHref = cl ? 'Cancel-Client.dc.html' : 'Cancel-Supplier.dc.html'; actCls = 'btn sm tint';
      cardCls = 'ck now2';
    } else if (lapse) {
      steps = S(['done', 'hold', 'todo', 'todo', 'todo'], ['11월 4일 · 양측 서명', '11월 7일 기한 지남', '', '', '']);
      segs = [
        { name: '중간 구간', chip: '결렬', chipCls: 'chip out', items: it(['예약 달력', ''], ['예약금 결제', '']), amtLabel: '구간 금액', amt: '1,550,000원', pay: '예치 전 · 오간 금액 없음' },
        { name: '최종 구간', chip: '결렬', chipCls: 'chip out', items: it(['노쇼 기록', ''], ['리마인드 알림', '']), amtLabel: '구간 금액', amt: '1,550,000원', pay: '예치 전 · 오간 금액 없음' }
      ];
      chip = '결렬'; chipCls = 'chip out'; dd = '11월 8일 결렬 · 예치 기한 초과'; ddCls = 'dd';
      if (cl) {
        todo = '예치 기한(11월 7일)이 지나 결렬되었습니다. 보류했던 지원자 중 다시 고를 수 있습니다.';
        actLabel = '제안 비교로'; actHref = 'Compare-Client.dc.html'; actCls = 'btn sm tint';
      } else {
        todo = '의뢰인이 예치 기한(11월 7일)까지 예치하지 않아 결렬되었습니다. 예치 전이라 오간 금액은 없습니다.';
        actLabel = '프로젝트 찾기'; actHref = 'Find-Supplier.dc.html'; actCls = 'btn sm tint';
      }
    } else if (late) {
      steps = S(['done', 'done', 'done', 'hold', 'todo'], ['11월 4일', '11월 4일 · 3,255,000원', '11월 27일 지급', '마감 12월 16일 지남 · 납품 없음', '']);
      segs = [
        { name: '중간 구간', chip: '지급 완료', chipCls: 'chip teal', items: it(['예약 달력 승인', 'ok'], ['예약금 결제 승인(보완 1회)', 'ok']), amtLabel: cl ? '지급' : '받음', amt: cl ? '1,550,000원' : '1,472,500원', pay: '11월 27일' },
        { name: '최종 구간', chip: '납품 없음', chipCls: 'chip amber', items: it(['노쇼 기록', ''], ['리마인드 알림', '']), amtLabel: cl ? '지급 전' : '받기 전', amt: cl ? '1,550,000원' : '1,472,500원', pay: cl ? '취소 사유 \'공급자 사정\'이면 전액 환불' : '마감 12월 16일 지남' }
      ];
      chip = '마감 지남 · 최종 납품 없음'; chipCls = 'chip amber'; dd = '작업 마감 12월 16일 · 2일 지남'; ddCls = 'dd soon';
      todo = cl ? '작업 마감이 지났는데 최종 납품이 없습니다. 채팅으로 새 날짜를 정해 기다리거나, 계약 취소를 요청할 수 있습니다.'
                : '마감이 지났습니다 · 납품하거나 의뢰인과 채팅으로 일정을 정하세요.';
      if (cl) { hasAct = false; }
      else { actLabel = '납품하기'; actHref = 'Deliver-Supplier.dc.html'; actCls = 'btn sm tint'; }
      cardCls = 'ck now2';
    } else if (act) {
      steps = S(['done', 'done', 'done', 'now', 'todo'], ['11월 4일', '11월 4일 · 3,255,000원', '11월 27일 지급', '작업 중 · 마감 12월 16일', '']);
      segs = [
        { name: '중간 구간', chip: '지급 완료', chipCls: 'chip teal', items: it(['예약 달력 승인', 'ok'], ['예약금 결제 승인(보완 1회)', 'ok']), amtLabel: cl ? '지급' : '받음', amt: cl ? '1,550,000원' : '1,472,500원', pay: '11월 27일' },
        { name: '최종 구간', chip: '작업 중', chipCls: 'chip blue', items: it(['노쇼 기록', ''], ['리마인드 알림', '']), amtLabel: cl ? '지급 예정' : '받을 예정', amt: cl ? '1,550,000원' : '1,472,500원', pay: '최종 항목이 모두 승인되면' }
      ];
      chip = '진행 중'; chipCls = 'chip blue'; dd = '작업 마감 12월 16일 · D-19'; ddCls = 'dd';
      if (cl) {
        todo = '공급자가 최종 구간을 작업 중입니다. 납품되면 검수할 수 있습니다.';
        actLabel = '검수하기'; actHref = 'Inspect-Client.dc.html'; hasAct = false; actOff = true;
      } else {
        todo = '최종 구간(노쇼 기록 · 리마인드 알림)을 12월 16일까지 납품해 주세요.';
        actLabel = '납품하기'; actHref = 'Deliver-Supplier.dc.html'; actCls = 'btn sm tint';
      }
    } else {
      steps = S(['done', 'done', 'done', 'done', 'done'], ['11월 4일', '11월 4일', '11월 27일 지급', '12월 16일 지급', '12월 16일']);
      segs = [
        { name: '중간 구간', chip: '지급 완료', chipCls: 'chip teal', items: it(['예약 달력 승인', 'ok'], ['예약금 결제 승인', 'ok']), amtLabel: cl ? '지급' : '받음', amt: cl ? '1,550,000원' : '1,472,500원', pay: '11월 27일' },
        { name: '최종 구간', chip: '지급 완료', chipCls: 'chip teal', items: it(['노쇼 기록 승인', 'ok'], ['리마인드 알림 승인', 'ok']), amtLabel: cl ? '지급' : '받음', amt: cl ? '1,550,000원' : '1,472,500원', pay: '12월 16일' }
      ];
      chip = '완료'; chipCls = 'chip teal'; dd = '12월 16일 완료'; ddCls = 'dd';
      todo = cl ? '최준호님과의 거래는 어떠셨나요? 리뷰는 한 번만 쓸 수 있고 고칠 수 없습니다.'
                : '온도 다이닝과의 거래는 어떠셨나요? 리뷰는 한 번만 쓸 수 있고 고칠 수 없습니다.';
      actLabel = '리뷰 쓰기'; actHref = 'Review-Client.dc.html'; actCls = 'btn sm'; cardCls = 'ck now2';
    }

    const cards = [{
      cls: cardCls, title: '예약 달력, 예약금 결제 외 2개 기능',
      who: cl ? '공급자 최준호 · ★ 4.8' : '의뢰인 온도 다이닝 · 정민재',
      period: sign || esc || lapse ? '작업 기간 42일(예치 다음 날부터)' : '작업 기간 42일 · 11월 4일 ~ 12월 16일',
      chip: chip, chipCls: chipCls, dd: dd, ddCls: ddCls, steps: steps, segs: segs, todo: todo,
      act: actLabel, actHref: actHref, actCls: actCls, hasAct: hasAct, actOff: actOff, hasCx: cl && act,
      late: cl && late, plainChat: !(cl && late), ln: ln, hasLn: !!ln
    }];

    // 끝난 계약
    let ended;
    if (cl) {
      ended = [{ cls: 'ed off', chip: '결렬', chipCls: 'chip out', title: '포장 주문 접수 외 1개 기능', who: '공급자 김세라', amt: '합의 2,400,000원', when: '10월 31일 결렬',
        note: '7일 안에 공급자 서명이 없어 결렬되었습니다. 예치 전이라 오간 금액은 없습니다.', hasNote: true, hasRv: false, canRv: false, rv: '' },
        { cls: 'ed', chip: '완료', chipCls: 'chip teal', title: '메뉴판 페이지, 오시는 길 외 1개 기능', who: '공급자 이도윤', amt: '합의 900,000원', when: '9월 30일 완료',
          note: '', hasNote: false, hasRv: true, canRv: false, rv: '내 리뷰 씀 · 받은 리뷰 ★ 5' },
        { cls: 'ed', chip: '완료', chipCls: 'chip teal', title: '단체 예약 문의 폼 외 1개 기능', who: '공급자 한서진', amt: '합의 700,000원', when: '9월 18일 완료',
          note: '', hasNote: false, hasRv: true, canRv: false, rv: '내 리뷰 씀 · 받은 리뷰 ★ 4' }];
    } else {
      ended = [
        { cls: 'ed', chip: '완료', chipCls: 'chip teal', title: '케이크 예약, 픽업 시간 선택 외 1개 기능', who: '의뢰인 하루 베이커리', amt: '합의 1,600,000원', when: '8월 22일 완료',
          note: '', hasNote: false, hasRv: true, canRv: false, rv: '내 리뷰 씀 · 받은 리뷰 ★ 5' },
        { cls: 'ed', chip: '완료', chipCls: 'chip teal', title: '테이블 예약, 대기 등록 외 2개 기능', who: '의뢰인 담소 키친', amt: '합의 2,000,000원', when: '10월 18일 완료',
          note: '', hasNote: false, hasRv: true, canRv: true, rv: '받은 리뷰 ★ 5' },
        { cls: 'ed off', chip: '결렬', chipCls: 'chip out', title: '단골 등급 관리 외 1개 기능', who: '의뢰인 면옥', amt: '합의 1,800,000원', when: '9월 12일 결렬',
          note: '서명을 거절해 결렬되었습니다. 예치 전이라 오간 금액은 없습니다.', hasNote: true, hasRv: false, canRv: false, rv: '' }
      ];
    }

    const c = (n: string, k: number, hot?: boolean) => ({ name: n, n: k, cls: hot ? 'hot' : '' });
    const counts = [
      c('서명 대기', sign ? 1 : 0, sign), c('예치 대기', esc ? 1 : 0, esc), c('진행 중', act || insp || cx || late ? 1 : 0, insp || cx || late),
      c('완료', (done ? 1 : 0) + 2), c('결렬 · 취소', 1 + (lapse ? 1 : 0), lapse)
    ];

    return {
      isClient: cl, isSupplier: !cl,
      chatHref: cl ? 'Chat-Client.dc.html' : 'Chat-Supplier.dc.html',
      sub: cl ? '계약의 진행 상태를 여기서 봅니다. 예치 · 납품 · 지급은 따로 알림을 보내지 않고 이 화면에 표시합니다.'
              : '계약의 진행 상태를 여기서 봅니다. 예치 · 검수 결과 · 지급은 따로 알림을 보내지 않고 이 화면에 표시합니다.',
      counts: counts, cards: cards, ended: ended, nEnded: ended.length
    };
  }
}
