import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 견적 작성 */
export default class QuotewriteSupplierScreen extends Screen {
  static override readonly id = "QuoteWrite-Supplier";
  static override readonly title = "공급자 — 견적 작성";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["작성 중", "모두 불가", "연락처 가림", "재견적"], "default": "작성 중", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '작성 중';
    const allNoV = v === '모두 불가', masked = v === '연락처 가림', requote = v === '재견적';
    const won = (n: number) => n.toLocaleString('ko-KR') + '원';
    let spec = [
      ['예약 달력', '회차별로 예약받고 정원이 차면 마감', '회차 구성 · 예약 가능 기간'],
      ['예약금 결제', '예약할 때 예약금을 받고 환불 규정 안내', '예약금 금액 · 환불 기준'],
      ['노쇼 기록', '노쇼 손님을 기록해 다음 예약 때 표시', '노쇼 판정 기준 · 표시 방식'],
      ['리마인드 알림', '예약 전날 손님에게 안내 자동 발송', '발송 시점 · 발송 수단']
    ];
    let chg = ['', '', '', ''];
    if (requote) {
      spec[3] = ['리마인드 알림', '예약 전날과 당일 3시간 전 손님에게 안내 자동 발송', '발송 시점 · 발송 수단'];
      spec.push(['단골 표시', '세 번 이상 방문한 손님을 예약 목록에 표시', '단골 기준']);
      chg = ['', '', '', '설명 바뀜', '새 항목'];
    }
    const ok = spec.map((s, i) => allNoV ? false : true);
    const okCnt = ok.filter(Boolean).length;
    const items = spec.map((s, i) => ({
      cls: 'ir' + (i === 0 ? ' first' : '') + (ok[i] ? '' : ' dis'), name: s[0], desc: s[1], cond: s[2],
      ok: ok[i], no: !ok[i], chg: chg[i] || '',
      okCls: ok[i] ? 'on' : '', noCls: ok[i] ? '' : 'on no'
    }));
    const amtN = allNoV ? 0 : (requote ? 3100000 : 3000000);
    const msg = '소규모 식당 예약 사이트를 12곳 만들었습니다. 예약 달력과 PG 결제 연동은 거의 매번 하는 작업이라 일정이 안정적입니다.\n중간 납품 때 관리 화면부터 보여 드리겠습니다. 정해야 할 조건은 문의 채팅에서 편하게 물어봐 주세요.';
    return {
      crumbLast: requote ? '다시 견적' : '견적 작성',
      title: requote ? '다시 견적하기 · 3회차' : '견적 작성',
      requote: requote, items: items, okCnt: okCnt, nItems: spec.length, allNo: allNoV, canSubmit: !allNoV,
      amtVal: allNoV ? '' : (requote ? '3,100,000' : '3,000,000'), daysVal: allNoV ? '' : '42',
      amt: won(amtN), fee: won(Math.round(amtN * 0.05)), net: won(Math.round(amtN * 0.95)),
      daysTxt: allNoV ? '—' : '42일',
      masked: masked, plain: !masked, msg: msg, msgLen: masked ? 118 : msg.length,
      submit: requote ? '다시 제출하기' : '제출하기',
      askOpen: !requote, askSub: requote ? '2회차에 남긴 질문 2개를 그대로 보냅니다' : '선택 · 최대 3개'
    };
  }
}
