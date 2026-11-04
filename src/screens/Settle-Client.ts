import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 결제 · 정산 내역 */
export default class SettleClientScreen extends Screen {
  static override readonly id = "Settle-Client";
  static override readonly title = "의뢰인 — 결제 · 정산 내역";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["전체", "계약 하나만", "취소된 계약 예시"], "default": "전체", "section": "상태"}};


  renderVals(): Values {
    const role = '의뢰인';
    const view = this.props.view ?? '전체';
    const cl = role === '의뢰인';
    const one = view === '계약 하나만', ex = view === '취소된 계약 예시';
    type Chip = [string, string];
    const ok: Chip = ['chip teal', '완료'], paid: Chip = ['chip teal', '지급 완료'], plan: Chip = ['chip out', '예정'], op: Chip = ['chip amber', '운영자 처리 중'];
    const R = (cls: string, d: string, k: string, nt: string, am: string, sub: string, ch: Chip) => ({ cls: 'tr' + (cls ? ' ' + cls : ''), d: d, k: k, nt: nt, am: am, sub: sub || '', chipCls: ch[0], chip: ch[1] });
    const C = (o: Values): Values => Object.assign({ cls: 'pc', isGrp: false, grp: '', hasStats: true, hasRows: true, hasCx: false, cx: [], cxH: '', stats: [], rows: [], hasEv: false, evK: '', evV: '', evCls: '' }, o);
    // 증빙: 수수료는 마자용 발행, 대금은 공급자(사업자)가 세금계산서 발행
    const E = (who: string, st: boolean, txt: string) => ({ hasEv: true, evK: '대금 증빙 · ' + who + '(사업자) 발행', evV: txt, evCls: st ? 'ok' : 'wt' });
    const A = '예약 달력, 예약금 결제 외 2개 기능';
    let cards, sum, oneName, oneIdx;
    if (cl) {
      const a = C({ chip: '진행 중', chipCls: 'chip blue', when: '작업 마감 12월 16일', title: A, who: '공급자 최준호', amt: '합의 3,100,000원 · 중간 50 : 최종 50',
        bigK: '예치한 금액', bigV: '3,255,000원', href: 'Contracts-Client.dc.html', ...E('최준호', false, '중간분 발행됨 · 최종분 대기'),
        stats: [{ k: '공급자에게 지급', v: '1,550,000원' }, { k: '남은 예치금', v: '1,550,000원' }, { k: '낸 수수료 5%', v: '155,000원' }],
        rows: [
          R('', '11월 4일', '예치', '합의 3,100,000원 + 수수료 155,000원 · 카드', '3,255,000원', '', ok),
          R('', '11월 27일', '중간 구간 지급', '예약 달력 · 예약금 결제 승인(보완 1회)', '1,550,000원', '최준호님에게', paid),
          R('plan', '최종 승인 때', '최종 구간 지급', '노쇼 기록 · 리마인드 알림이 모두 승인되면', '1,550,000원', '', plan)] });
      const b = C({ chip: '완료', chipCls: 'chip teal', when: '9월 30일 완료', title: '메뉴판 페이지, 오시는 길 외 1개 기능', who: '공급자 이도윤', amt: '합의 900,000원 · 중간 50 : 최종 50',
        bigK: '예치한 금액', bigV: '945,000원', href: 'Contracts-Client.dc.html', ...E('이도윤', true, '세금계산서 발행됨'),
        stats: [{ k: '공급자에게 지급', v: '900,000원' }, { k: '남은 예치금', v: '0원' }, { k: '낸 수수료 5%', v: '45,000원' }],
        rows: [
          R('', '9월 2일', '예치', '합의 900,000원 + 수수료 45,000원 · 카드', '945,000원', '', ok),
          R('', '9월 16일', '중간 구간 지급', '메뉴판 페이지 승인', '450,000원', '이도윤님에게', paid),
          R('', '9월 30일', '최종 구간 지급', '오시는 길 · 영업시간 안내 승인', '450,000원', '이도윤님에게', paid)] });
      const c = C({ chip: '완료', chipCls: 'chip teal', when: '9월 18일 완료', title: '단체 예약 문의 폼 외 1개 기능', who: '공급자 한서진', amt: '합의 700,000원 · 중간 50 : 최종 50',
        bigK: '예치한 금액', bigV: '735,000원', href: 'Contracts-Client.dc.html', ...E('한서진', true, '세금계산서 발행됨'),
        stats: [{ k: '공급자에게 지급', v: '700,000원' }, { k: '남은 예치금', v: '0원' }, { k: '낸 수수료 5%', v: '35,000원' }],
        rows: [
          R('', '8월 28일', '예치', '합의 700,000원 + 수수료 35,000원 · 계좌이체', '735,000원', '', ok),
          R('', '9월 8일', '중간 구간 지급', '단체 예약 문의 폼 승인', '350,000원', '한서진님에게', paid),
          R('', '9월 18일', '최종 구간 지급', '문의 알림 메일 승인', '350,000원', '한서진님에게', paid)] });
      const d = C({ cls: 'pc end', chip: '결렬', chipCls: 'chip out', when: '10월 31일 결렬', title: '포장 주문 접수 외 1개 기능', who: '공급자 김세라', amt: '합의 2,400,000원',
        bigK: '오간 금액', bigV: '0원', href: 'Contracts-Client.dc.html', hasStats: false, hasRows: false });
      const x = C({ cls: 'pc cx', chip: '취소 · 환불 처리 중', chipCls: 'chip amber', when: '11월 20일 정산 확정', title: '단골 쿠폰 발송 외 1개 기능', who: '공급자 서도윤', amt: '합의 2,000,000원 · 의뢰인 사유 취소(납품 전)',
        bigK: '돌려받을 금액', bigV: '1,575,000원', href: 'Contracts-Client.dc.html', ...E('서도윤', false, '대기 · 보상 지급 후'),
        stats: [{ k: '예치한 금액', v: '2,100,000원' }, { k: '공급자 보상', v: '500,000원' }, { k: '돌려받을 금액', v: '1,575,000원' }],
        rows: [
          R('', '11월 8일', '예치', '합의 2,000,000원 + 수수료 100,000원', '2,100,000원', '', ok),
          R('', '11월 20일', '취소 보상', '진행 중 구간 1,000,000원의 50% · 서도윤님에게', '500,000원', '', ['chip teal', '확정']),
          R('', '11월 20일', '환불', '결제한 카드로 돌려드립니다', '1,575,000원', '', op)],
        hasCx: true, cxH: '취소 정산 계산 — 정산은 계약당 한 번',
        cx: [{ cls: 'r', k: '예치한 금액', v: '2,100,000원' }, { cls: 'r', k: '− 공급자 보상(진행 중 구간 1,000,000원의 50%)', v: '− 500,000원' },
             { cls: 'r', k: '− 보상분 수수료 5%(지급이 확정된 금액에만)', v: '− 25,000원' }, { cls: 'r tot', k: '돌려받을 금액', v: '1,575,000원' }] });
      d.isGrp = true; d.grp = '끝난 계약';
      cards = ex ? [x, a, Object.assign({}, b, { isGrp: true, grp: '끝난 계약' }), c, Object.assign({}, d, { isGrp: false })] : [a, b, c, d];
      if (!ex) { b.isGrp = true; b.grp = '끝난 계약'; d.isGrp = false; }
      oneName = b.title + ' · 이도윤'; oneIdx = 1;
      sum = one ? [
        { k: '예치한 금액', v: '945,000원', s: '합의 900,000원 + 수수료 5%' }, { k: '공급자에게 지급', v: '900,000원', s: '중간 · 최종 구간' },
        { k: '남은 예치금', v: '0원', s: '계약 완료' }, { k: '낸 수수료', v: '45,000원', s: '지급이 확정된 금액의 5%' }
      ] : ex ? [
        { k: '예치한 금액', v: '7,035,000원', s: '계약 4건 · 수수료 포함' }, { k: '공급자에게 지급', v: '3,650,000원', s: '구간 지급 + 취소 보상 500,000원' },
        { k: '남은 예치금', v: '1,550,000원', s: '진행 중 1건 · 환불 중인 금액 제외' }, { k: '낸 수수료', v: '260,000원', s: '지급 확정 금액의 5% · 예치 때 함께 냄' }
      ] : [
        { k: '예치한 금액', v: '4,935,000원', s: '계약 3건 · 수수료 포함' }, { k: '공급자에게 지급', v: '3,150,000원', s: '구간 승인 때마다' },
        { k: '남은 예치금', v: '1,550,000원', s: '진행 중 1건 · 최종 승인 때 지급' }, { k: '낸 수수료', v: '235,000원', s: '지급 확정 금액의 5% · 예치 때 함께 냄' }
      ];
    } else {
      const S = (d: string, k: string, nt: string, gross: string, net: string, ch: Chip, cls?: string) => R(cls || '', d, k, nt, net, gross ? '구간 ' + gross + ' − 수수료 5%' : '', ch);
      const a = C({ chip: '진행 중', chipCls: 'chip blue', when: '작업 마감 12월 16일', title: A, who: '의뢰인 온도 다이닝', amt: '합의 3,100,000원 · 중간 50 : 최종 50',
        bigK: '받은 금액', bigV: '1,472,500원', href: 'Contracts-Supplier.dc.html',
        stats: [{ k: '받은 금액', v: '1,472,500원' }, { k: '받을 예정', v: '1,472,500원' }, { k: '낸 수수료 5%', v: '77,500원' }],
        rows: [
          R('info', '11월 4일', '의뢰인 예치', '3,255,000원 예치 완료 — 작업 기간 시작', '—', '', ['chip out', '보관 중']),
          S('11월 27일', '중간 구간', '예약 달력 · 예약금 결제 승인(보완 1회)', '1,550,000원', '1,472,500원', paid),
          S('최종 승인 때', '최종 구간', '노쇼 기록 · 리마인드 알림', '1,550,000원', '1,472,500원', plan, 'plan')] });
      const b = C({ chip: '완료', chipCls: 'chip teal', when: '10월 18일 완료', title: '테이블 예약, 대기 등록 외 2개 기능', who: '의뢰인 담소 키친', amt: '합의 2,000,000원 · 중간 50 : 최종 50',
        bigK: '받은 금액', bigV: '1,900,000원', href: 'Contracts-Supplier.dc.html',
        stats: [{ k: '받은 금액', v: '1,900,000원' }, { k: '받을 예정', v: '0원' }, { k: '낸 수수료 5%', v: '100,000원' }],
        rows: [
          S('9월 30일', '중간 구간', '테이블 예약 · 대기 등록 승인', '1,000,000원', '950,000원', paid),
          S('10월 18일', '최종 구간', '입장 알림 승인', '1,000,000원', '950,000원', paid)] });
      const c = C({ chip: '완료', chipCls: 'chip teal', when: '8월 22일 완료', title: '케이크 예약, 픽업 시간 선택 외 1개 기능', who: '의뢰인 하루 베이커리', amt: '합의 1,600,000원 · 중간 50 : 최종 50',
        bigK: '받은 금액', bigV: '1,520,000원', href: 'Contracts-Supplier.dc.html',
        stats: [{ k: '받은 금액', v: '1,520,000원' }, { k: '받을 예정', v: '0원' }, { k: '낸 수수료 5%', v: '80,000원' }],
        rows: [
          S('8월 5일', '중간 구간', '케이크 예약 승인', '800,000원', '760,000원', paid),
          S('8월 22일', '최종 구간', '픽업 시간 선택 · 주문 알림 승인', '800,000원', '760,000원', paid)] });
      const d = C({ cls: 'pc end', chip: '결렬', chipCls: 'chip out', when: '9월 12일 결렬', title: '단골 등급 관리 외 1개 기능', who: '의뢰인 면옥', amt: '합의 1,800,000원',
        bigK: '오간 금액', bigV: '0원', href: 'Contracts-Supplier.dc.html', hasStats: false, hasRows: false });
      const x = C({ cls: 'pc cx', chip: '취소 · 지급 처리 중', chipCls: 'chip amber', when: '11월 20일 정산 확정', title: '브런치 예약, 대기 알림 외 1개 기능', who: '의뢰인 브런치 하루', amt: '합의 2,000,000원 · 의뢰인 사유 취소(납품 전)',
        bigK: '받을 금액', bigV: '475,000원', href: 'Contracts-Supplier.dc.html',
        stats: [{ k: '진행 중이던 구간', v: '1,000,000원' }, { k: '보상 금액', v: '500,000원' }, { k: '받을 금액', v: '475,000원' }],
        rows: [S('11월 20일', '취소 보상', '진행 중 구간 1,000,000원의 50%', '500,000원', '475,000원', op)],
        hasCx: true, cxH: '취소 정산 계산 — 정산은 계약당 한 번',
        cx: [{ cls: 'r', k: '진행 중이던 구간 금액(중간 구간)', v: '1,000,000원' }, { cls: 'r', k: '보상 금액(의뢰인 사유 · 납품 전 → 50%)', v: '500,000원' },
             { cls: 'r', k: '− 수수료 5%(지급이 확정된 보상 금액에만)', v: '− 25,000원' }, { cls: 'r tot', k: '받을 금액 · 나머지 1,575,000원은 의뢰인에게 환불', v: '475,000원' }] });
      cards = ex ? [x, a, Object.assign({}, b, { isGrp: true, grp: '끝난 계약' }), c, d] : [a, Object.assign({}, b, { isGrp: true, grp: '끝난 계약' }), c, d];
      oneName = b.title + ' · 담소 키친'; oneIdx = 1;
      sum = one ? [
        { k: '받은 금액', v: '1,900,000원', s: '중간 · 최종 구간 · 수수료 뺀 금액' }, { k: '받을 예정', v: '0원', s: '계약 완료' }, { k: '낸 수수료', v: '100,000원', s: '지급이 확정된 금액의 5%' }
      ] : ex ? [
        { k: '받은 금액', v: '4,892,500원', s: '계약 3건 · 수수료 뺀 금액' }, { k: '받을 예정', v: '1,947,500원', s: '온도 다이닝 최종 구간 + 취소 보상 475,000원' }, { k: '낸 수수료', v: '282,500원', s: '지급이 확정된 금액의 5%' }
      ] : [
        { k: '받은 금액', v: '4,892,500원', s: '계약 3건 · 수수료 뺀 금액' }, { k: '받을 예정', v: '1,472,500원', s: '온도 다이닝 최종 구간 · 최종 승인 때' }, { k: '낸 수수료', v: '257,500원', s: '지급이 확정된 금액의 5%' }
      ];
    }
    if (one) cards = [Object.assign({}, cards[ex ? oneIdx + 1 : oneIdx], { isGrp: false, cls: 'pc hl' })];
    cards = cards.map(p => Object.assign({}, p, { nStats: p.stats.length + (p.hasEv ? 1 : 0) }));
    const self = cl ? 'Settle-Client.dc.html' : 'Settle-Supplier.dc.html';
    return {
      isClient: cl, isSupplier: !cl, one: one, all: !one, oneName: oneName, selfHref: self,
      contractsHref: cl ? 'Contracts-Client.dc.html' : 'Contracts-Supplier.dc.html',
      crumb: one ? '내 계약 › 정산 내역 › 계약 하나' : '내 계약 › 정산 내역',
      title: cl ? '결제 · 정산 내역' : '정산 내역',
      sub: cl ? '계약마다 예치한 금액이 언제, 얼마나 공급자에게 지급되었는지 봅니다. 예치금은 구간이 승인될 때만 공급자에게 넘어갑니다.'
              : '계약마다 받은 금액과 받을 금액을 봅니다. 구간이 승인되면 수수료 5%를 뺀 금액이 지급됩니다.',
      smCls: cl ? 'sm c4' : 'sm c3', sum: sum, cards: cards, nCards: cards.length
    };
  }
}
