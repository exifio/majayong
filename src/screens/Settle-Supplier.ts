import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 결제 · 정산 내역 */
export default class SettleSupplierScreen extends Screen {
  static override readonly id = "Settle-Supplier";
  static override readonly title = "공급자 — 결제 · 정산 내역";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["전체", "계약 하나만", "취소된 계약 예시", "개인 공급자 예시"], "default": "전체", "section": "상태"}};


  renderVals(): Values {
    const role: string = '공급자';
    const view = this.props.view ?? '전체';
    const cl = role === '의뢰인';
    const one = view === '계약 하나만', ex = view === '취소된 계약 예시', indiv = view === '개인 공급자 예시';
    type Chip = [string, string];
    const ok: Chip = ['chip teal', '완료'], paid: Chip = ['chip teal', '지급 완료'], plan: Chip = ['chip out', '예정'], op: Chip = ['chip amber', '운영자 처리 중'];
    const R = (cls: string, d: string, k: string, nt: string, am: string, sub: string, ch: Chip) => ({ cls: 'tr' + (cls ? ' ' + cls : ''), d: d, k: k, nt: nt, am: am, sub: sub || '', chipCls: ch[0], chip: ch[1] });
    const C = (o: Values): Values => Object.assign({ cls: 'pc', isGrp: false, grp: '', hasStats: true, hasRows: true, hasCx: false, cx: [], cxH: '', stats: [], rows: [] }, o);
    const A = '예약 달력, 예약금 결제 외 2개 기능';
    let cards, sum, oneName, oneIdx;
    if (cl) {
      const a = C({ chip: '진행 중', chipCls: 'chip blue', when: '작업 마감 12월 16일', title: A, who: '공급자 최준호', amt: '합의 3,100,000원 · 중간 50 : 최종 50',
        bigK: '예치한 금액', bigV: '3,255,000원', href: 'Contracts-Client.dc.html',
        stats: [{ k: '공급자에게 지급', v: '1,550,000원' }, { k: '남은 예치금', v: '1,550,000원' }, { k: '낸 수수료 5%', v: '155,000원' }],
        rows: [
          R('', '11월 4일', '예치', '합의 3,100,000원 + 수수료 155,000원 · 카드', '3,255,000원', '', ok),
          R('', '11월 27일', '중간 구간 지급', '예약 달력 · 예약금 결제 승인(보완 1회)', '1,550,000원', '최준호님에게', paid),
          R('plan', '최종 승인 때', '최종 구간 지급', '노쇼 기록 · 리마인드 알림이 모두 승인되면', '1,550,000원', '', plan)] });
      const b = C({ chip: '완료', chipCls: 'chip teal', when: '9월 30일 완료', title: '메뉴판 페이지, 오시는 길 외 1개 기능', who: '공급자 이도윤', amt: '합의 900,000원 · 중간 50 : 최종 50',
        bigK: '예치한 금액', bigV: '945,000원', href: 'Contracts-Client.dc.html',
        stats: [{ k: '공급자에게 지급', v: '900,000원' }, { k: '남은 예치금', v: '0원' }, { k: '낸 수수료 5%', v: '45,000원' }],
        rows: [
          R('', '9월 2일', '예치', '합의 900,000원 + 수수료 45,000원 · 카드', '945,000원', '', ok),
          R('', '9월 16일', '중간 구간 지급', '메뉴판 페이지 승인', '450,000원', '이도윤님에게', paid),
          R('', '9월 30일', '최종 구간 지급', '오시는 길 · 영업시간 안내 승인', '450,000원', '이도윤님에게', paid)] });
      const c = C({ chip: '완료', chipCls: 'chip teal', when: '9월 18일 완료', title: '단체 예약 문의 폼 외 1개 기능', who: '공급자 한서진', amt: '합의 700,000원 · 중간 50 : 최종 50',
        bigK: '예치한 금액', bigV: '735,000원', href: 'Contracts-Client.dc.html',
        stats: [{ k: '공급자에게 지급', v: '700,000원' }, { k: '남은 예치금', v: '0원' }, { k: '낸 수수료 5%', v: '35,000원' }],
        rows: [
          R('', '8월 28일', '예치', '합의 700,000원 + 수수료 35,000원 · 계좌이체', '735,000원', '', ok),
          R('', '9월 8일', '중간 구간 지급', '단체 예약 문의 폼 승인', '350,000원', '한서진님에게', paid),
          R('', '9월 18일', '최종 구간 지급', '문의 알림 메일 승인', '350,000원', '한서진님에게', paid)] });
      const d = C({ cls: 'pc end', chip: '결렬', chipCls: 'chip out', when: '10월 31일 결렬', title: '포장 주문 접수 외 1개 기능', who: '공급자 김세라', amt: '합의 2,400,000원',
        bigK: '오간 금액', bigV: '0원', href: 'Contracts-Client.dc.html', hasStats: false, hasRows: false });
      const x = C({ cls: 'pc cx', chip: '취소 · 환불 처리 중', chipCls: 'chip amber', when: '11월 20일 정산 확정', title: '단골 쿠폰 발송 외 1개 기능', who: '공급자 서도윤', amt: '합의 2,000,000원 · 의뢰인 사유 취소(납품 전)',
        bigK: '돌려받을 금액', bigV: '1,575,000원', href: 'Contracts-Client.dc.html',
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
        { k: '남은 예치금', v: '1,550,000원', s: '진행 중 1건 · 환불 중인 금액 제외' }, { k: '낸 수수료', v: '260,000원', s: '지급이 확정된 금액의 5%' }
      ] : [
        { k: '예치한 금액', v: '4,935,000원', s: '계약 3건 · 수수료 포함' }, { k: '공급자에게 지급', v: '3,150,000원', s: '구간 승인 때마다' },
        { k: '남은 예치금', v: '1,550,000원', s: '진행 중 1건 · 최종 승인 때 지급' }, { k: '낸 수수료', v: '235,000원', s: '합의 금액의 5%' }
      ];
    } else {
      const S = (d: string, k: string, nt: string, gross: string, net: string, ch: Chip, cls?: string, wh?: number) => R(cls || '', d, k, nt, net, gross ? '구간 ' + gross + ' − 수수료 5%' + (wh ? ' − 원천징수 3.3%' : '') : '', ch);
      const F = (v: string) => ({ k: '낸 수수료 5%', v: v, hasLk: true, lk: '수수료 증빙 받기', href: '#receipt' });
      const T = (v: string, lk?: string) => ({ k: '대금 세금계산서 · 의뢰인에게 직접', v: v, vCls: lk ? 'v dim2' : 'v', hasLk: !!lk, lk: lk || '', href: '#issued' });
      const W = (v: string) => ({ k: '원천징수 3.3%', v: v, hasLk: true, lk: '원천징수영수증', href: '#wh' });
      const a = C({ chip: '진행 중', chipCls: 'chip blue', when: '작업 마감 12월 16일', title: A, who: '의뢰인 온도 다이닝', amt: '합의 3,100,000원 · 중간 50 : 최종 50',
        bigK: '받은 금액', bigV: '1,472,500원', href: 'Contracts-Supplier.dc.html',
        stats: [{ k: '받은 금액', v: '1,472,500원' }, { k: '받을 예정', v: '1,472,500원' }, F('77,500원'), T('중간 구간 발행 전', '발행했어요')],
        rows: [
          R('info', '11월 4일', '의뢰인 예치', '3,255,000원 예치 완료 — 작업 기간 시작', '—', '', ['chip out', '보관 중']),
          S('11월 27일', '중간 구간', '예약 달력 · 예약금 결제 승인(보완 1회)', '1,550,000원', '1,472,500원', paid),
          S('최종 승인 때', '최종 구간', '노쇼 기록 · 리마인드 알림', '1,550,000원', '1,472,500원', plan, 'plan')] });
      const b = C({ chip: '완료', chipCls: 'chip teal', when: '10월 18일 완료', title: '테이블 예약, 대기 등록 외 2개 기능', who: '의뢰인 담소 키친', amt: '합의 2,000,000원 · 중간 50 : 최종 50',
        bigK: '받은 금액', bigV: '1,900,000원', href: 'Contracts-Supplier.dc.html',
        stats: [{ k: '받은 금액', v: '1,900,000원' }, { k: '받을 예정', v: '0원' }, F('100,000원'), T('✓ 발행했어요 · 2건')],
        rows: [
          S('9월 30일', '중간 구간', '테이블 예약 · 대기 등록 승인', '1,000,000원', '950,000원', paid),
          S('10월 18일', '최종 구간', '입장 알림 승인', '1,000,000원', '950,000원', paid)] });
      const c = C({ chip: '완료', chipCls: 'chip teal', when: '8월 22일 완료', title: '케이크 예약, 픽업 시간 선택 외 1개 기능', who: '의뢰인 하루 베이커리', amt: '합의 1,600,000원 · 중간 50 : 최종 50',
        bigK: '받은 금액', bigV: '1,520,000원', href: 'Contracts-Supplier.dc.html',
        stats: [{ k: '받은 금액', v: '1,520,000원' }, { k: '받을 예정', v: '0원' }, F('80,000원'), T('✓ 발행했어요 · 2건')],
        rows: [
          S('8월 5일', '중간 구간', '케이크 예약 승인', '800,000원', '760,000원', paid),
          S('8월 22일', '최종 구간', '픽업 시간 선택 · 주문 알림 승인', '800,000원', '760,000원', paid)] });
      const d = C({ cls: 'pc end', chip: '결렬', chipCls: 'chip out', when: '10월 12일 결렬', title: '클래스 예약, 수강권 결제 외 1개 기능', who: '의뢰인 공방 결', amt: '합의 1,900,000원 · 7일 안에 서명 없음',
        bigK: '오간 금액', bigV: '0원', href: 'Contracts-Supplier.dc.html', hasStats: false, hasRows: false });
      const x = C({ cls: 'pc cx', chip: '취소 · 지급 처리 중', chipCls: 'chip amber', when: '11월 20일 정산 확정', title: '브런치 예약, 대기 알림 외 1개 기능', who: '의뢰인 브런치 하루', amt: '합의 2,000,000원 · 의뢰인 사유 취소(납품 전)',
        bigK: '받을 금액', bigV: '475,000원', href: 'Contracts-Supplier.dc.html',
        stats: [{ k: '진행 중이던 구간', v: '1,000,000원' }, { k: '보상 금액', v: '500,000원' }, F('25,000원'), T('보상분 발행 전', '발행했어요')],
        rows: [S('11월 20일', '취소 보상', '진행 중 구간 1,000,000원의 50%', '500,000원', '475,000원', op)],
        hasCx: true, cxH: '취소 정산 계산 — 정산은 계약당 한 번',
        cx: [{ cls: 'r', k: '진행 중이던 구간 금액(중간 구간)', v: '1,000,000원' }, { cls: 'r', k: '보상 금액(의뢰인 사유 · 납품 전 → 50%)', v: '500,000원' },
             { cls: 'r', k: '− 수수료 5%(지급이 확정된 보상 금액에만)', v: '− 25,000원' }, { cls: 'r tot', k: '받을 금액 · 나머지 1,575,000원은 의뢰인에게 환불', v: '475,000원' }] });
      if (indiv) {
        a.bigV = '1,421,350원';
        a.stats = [{ k: '받은 금액', v: '1,421,350원' }, { k: '받을 예정', v: '1,421,350원' }, F('77,500원'), W('51,150원')];
        a.rows = [a.rows[0], S('11월 27일', '중간 구간', '예약 달력 · 예약금 결제 승인(보완 1회)', '1,550,000원', '1,421,350원', paid, '', 1),
          S('최종 승인 때', '최종 구간', '노쇼 기록 · 리마인드 알림', '1,550,000원', '1,421,350원', plan, 'plan', 1)];
        b.bigV = '1,834,000원';
        b.stats = [{ k: '받은 금액', v: '1,834,000원' }, { k: '받을 예정', v: '0원' }, F('100,000원'), W('66,000원')];
        b.rows = [S('9월 30일', '중간 구간', '테이블 예약 · 대기 등록 승인', '1,000,000원', '917,000원', paid, '', 1), S('10월 18일', '최종 구간', '입장 알림 승인', '1,000,000원', '917,000원', paid, '', 1)];
        c.bigV = '1,467,200원';
        c.stats = [{ k: '받은 금액', v: '1,467,200원' }, { k: '받을 예정', v: '0원' }, F('80,000원'), W('52,800원')];
        c.rows = [S('8월 5일', '중간 구간', '케이크 예약 승인', '800,000원', '733,600원', paid, '', 1), S('8월 22일', '최종 구간', '픽업 시간 선택 · 주문 알림 승인', '800,000원', '733,600원', paid, '', 1)];
      }
      cards = ex ? [x, a, Object.assign({}, b, { isGrp: true, grp: '끝난 계약' }), d, c] : indiv ? [a, Object.assign({}, b, { isGrp: true, grp: '끝난 계약' }), c] : [a, Object.assign({}, b, { isGrp: true, grp: '끝난 계약' }), d, c];
      oneName = b.title + ' · 담소 키친'; oneIdx = 1;
      const biz = { k: '정산 구분', v: '사업자', s: '원천징수 없음 · 세금계산서 직접 발행', hasLk: true, lk: '정산 정보 바꾸기' };
      sum = one ? [
        { k: '받은 금액', v: '1,900,000원', s: '중간 · 최종 구간 · 수수료 뺀 금액' }, { k: '받을 예정', v: '0원', s: '계약 완료' }, { k: '낸 수수료', v: '100,000원', s: '지급이 확정된 금액의 5%' }, biz
      ] : indiv ? [
        { k: '받은 금액', v: '4,722,550원', s: '최근 계약 3건 · 수수료 · 원천징수 뺀 금액' }, { k: '받을 예정', v: '1,421,350원', s: '온도 다이닝 최종 구간' }, { k: '낸 수수료', v: '257,500원', s: '지급이 확정된 금액의 5%' }, { k: '원천징수 3.3%', v: '169,950원', s: '구간 금액의 3.3% · 마자용이 지급 때 신고' }
      ] : ex ? [
        { k: '받은 금액', v: '4,892,500원', s: '최근 계약 3건 · 이전 계약 10건 제외' }, { k: '받을 예정', v: '1,947,500원', s: '온도 다이닝 최종 구간 + 취소 보상 475,000원' }, { k: '낸 수수료', v: '282,500원', s: '지급이 확정된 금액의 5%' }, biz
      ] : [
        { k: '받은 금액', v: '4,892,500원', s: '최근 계약 3건 · 이전 계약 10건 제외' }, { k: '받을 예정', v: '1,472,500원', s: '온도 다이닝 최종 구간 · 최종 승인 때' }, { k: '낸 수수료', v: '257,500원', s: '지급이 확정된 금액의 5%' }, biz
      ];
    }
    if (one) cards = [Object.assign({}, cards[ex ? oneIdx + 1 : oneIdx], { isGrp: false, cls: 'pc hl' })];
    cards = cards.map(p => Object.assign({}, p, { nStats: p.stats.length, stats: p.stats.map((t: Values) => Object.assign({ vCls: 'v', hasLk: false, lk: '', href: '#' }, t)) }));
    sum = sum.map(m => Object.assign({ hasLk: false, lk: '' }, m));
    const self = cl ? 'Settle-Client.dc.html' : 'Settle-Supplier.dc.html';
    return {
      isClient: cl, isSupplier: !cl, one: one, all: !one, indiv: indiv, oneName: oneName, selfHref: self,
      contractsHref: cl ? 'Contracts-Client.dc.html' : 'Contracts-Supplier.dc.html',
      crumb: one ? '내 계약 › 정산 내역 › 계약 하나' : indiv ? '내 계약 › 정산 내역 › 개인 공급자 예시' : '내 계약 › 정산 내역',
      title: cl ? '결제 · 정산 내역' : '정산 내역',
      sub: cl ? '계약마다 예치한 금액이 언제, 얼마나 공급자에게 지급되었는지 봅니다. 예치금은 구간이 승인될 때만 공급자에게 넘어갑니다.'
              : indiv ? '계약마다 받은 금액과 받을 금액을 봅니다. 구간이 승인되면 수수료 5%와 원천징수 3.3%를 뺀 금액이 지급됩니다.' : '계약마다 받은 금액과 받을 금액을 봅니다. 구간이 승인되면 수수료 5%를 뺀 금액이 지급됩니다.',
      smCls: sum.length === 4 ? 'sm c4' : 'sm c3', sum: sum, cards: cards, nCards: cards.length
    };
  }
}
