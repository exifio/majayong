import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 견적서 상세 */
export default class QuoteClientScreen extends Screen {
  static override readonly id = "Quote-Client";
  static override readonly title = "의뢰인 — 견적서 상세";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"supplier": {"editor": "enum", "options": ["최준호 (채팅에서 수정)", "김세라", "스튜디오 넛 (불가 1건)", "이전 명세 기준", "거절 확인"], "default": "최준호 (채팅에서 수정)", "section": "상태"}};


  renderVals(): Values {
    const v0 = this.props.supplier ?? '최준호 (채팅에서 수정)';
    const rejM = v0 === '거절 확인';
    const v = rejM ? '최준호 (채팅에서 수정)' : v0;
    const won = (n: number) => n.toLocaleString('ko-KR') + '원';
    const spec = [
      ['예약 달력', '회차별로 예약받고 정원이 차면 마감'],
      ['예약금 결제', '예약할 때 예약금을 받고 환불 규정 안내'],
      ['노쇼 기록', '노쇼 손님을 기록해 다음 예약 때 표시'],
      ['리마인드 알림', '예약 전날 손님에게 안내 자동 발송']];
    type Hist = { date: string; title: string; amt: number; days: number; why: string; now?: boolean };
    type Sup = { ini: string; name: string; career: string; rating: string; reviews: string; applied: string;
      amt: number; days: number; ok: number[]; chat: boolean; masked: boolean; qs?: string[]; msgA: string; msgB: string; hist: Hist[] };
    const S: Record<'cjh' | 'ksr' | 'nut', Sup> = {
      cjh: { ini: '최', name: '최준호', career: '경력 5년', rating: '★ 4.8', reviews: '리뷰 12건', applied: '10월 29일 지원',
        amt: 3100000, days: 42, ok: [1,1,1,1], chat: true, masked: true,
        qs: ['예약금은 카드 결제만 받으시나요, 계좌이체도 받으시나요?', '기존 전화 예약 고객 명단을 새 예약 화면으로 옮겨야 하나요?'],
        msgA: '회차제 코스 레스토랑 예약 사이트를 올해 만들어 지금도 운영을 돕고 있습니다. 예약금 금액과 환불 기준은 관리 화면에서 직접 바꾸실 수 있게 만들겠습니다. 리마인드는 문자보다 도달률이 높은 알림톡을 권합니다.\n작업 화면은 주 1회 공유드리고, 급한 문의는',
        msgB: '로 주셔도 됩니다.',
        hist: [ { date: '11월 1일 · 채팅에서 수정', title: '2회차', amt: 3100000, days: 42, why: '환불 기준을 회차별로 다르게 두려면 작업이 늘어납니다', now: true },
                { date: '10월 29일 · 지원', title: '1회차', amt: 3000000, days: 42, why: '' } ] },
      ksr: { ini: '김', name: '김세라', career: '경력 7년', rating: '★ 4.6', reviews: '리뷰 21건', applied: '10월 30일 지원',
        amt: 4400000, days: 35, ok: [1,1,1,1], chat: true, masked: false,
        qs: ['8인 이상 단체 예약도 온라인으로 받으실 건가요?'],
        msgA: '디자인부터 개발까지 혼자 맡습니다. 손님이 휴대폰으로 예약하기 편한 화면에 신경을 많이 쓰고, 문자 알림 연동 경험이 여러 번 있습니다. 전날 취소는 전액 환불, 당일 취소는 환불 없음을 기본값으로 두고 바꿀 수 있게 하겠습니다.',
        msgB: '',
        hist: [ { date: '10월 30일 · 지원', title: '1회차', amt: 4400000, days: 35, why: '', now: true } ] },
      nut: { ini: '넛', name: '스튜디오 넛', career: '제작사 · 경력 9년', rating: '평점 없음', reviews: '리뷰 없음', applied: '11월 1일 지원',
        amt: 4500000, days: 56, ok: [1,1,1,0], chat: false, masked: false,
        msgA: '기획 · 디자인 · 개발 3인이 함께 맡습니다. 예약과 결제, 노쇼 관리는 관리자 화면까지 포함해 만들고, 리마인드 알림은 이미 쓰고 계신 예약 앱의 알림을 그대로 쓰시는 편이 낫다고 판단해 이번 견적에서 뺐습니다.',
        msgB: '',
        hist: [ { date: '11월 1일 · 지원', title: '1회차', amt: 4500000, days: 56, why: '', now: true } ] }
    };
    const stale = v === '이전 명세 기준';
    const p = v.startsWith('김세라') || stale ? S.ksr : (v.startsWith('스튜디오') ? S.nut : S.cjh);
    const okCnt = p.ok.reduce((t, x) => t + x, 0);
    const hist = p.hist.map(h => ({ cls: h.now ? 'now' : '', date: h.date, title: h.title + (h.now ? ' · 지금 견적' : ''), amt: won(h.amt), days: h.days + '일', why: h.why }));
    return {
      rejM: rejM, rejName: p.name,
      ini: p.ini, name: p.name, career: p.career, rating: p.rating, reviews: p.reviews, applied: p.applied,
      rev: p.hist.length + '회차', stale: stale, canPick: !stale,
      total: won(p.amt), withFee: won(p.amt + Math.floor(p.amt * 0.05)), days: p.days + '일',
      chg: p.hist.length > 1 ? '채팅에서 수정 · 처음 ' + won(p.hist[p.hist.length - 1].amt) : '',
      okCnt: okCnt, okNote: okCnt === 4 ? '모든 항목 가능' : '불가 ' + (4 - okCnt) + '건',
      items: spec.map((s, i) => ({ cls: 'ir' + (i === 0 ? ' first' : '') + (p.ok[i] ? '' : ' dis'), name: s[0], desc: s[1], ok: !!p.ok[i], no: !p.ok[i] })),
      hasNo: okCnt < 4,
      msgA: p.msgA, msgB: p.msgB, masked: p.masked,
      qs: p.qs || [], qn: (p.qs || []).length, hasQ: !!(p.qs && p.qs.length),
      hist: hist, hasChat: p.chat,
      chatLabel: '문의하기 (채팅)',
      basis: stale ? '고치기 전 명세(1판) 기준 · 지금 명세는 2판' : '확정한 명세 1판 기준',
      footNote: stale ? '명세를 고치기 전에 받은 견적입니다. 공급자에게 재견적을 요청했고, 새 견적이 들어오면 계약할 수 있습니다.' : '조건을 채팅에서 정한 뒤, 채팅의 \'이 사람과 계약하기\'로 계약을 진행합니다.'
    };
  }
}
