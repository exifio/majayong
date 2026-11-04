import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 제안 비교 */
export default class CompareClientScreen extends Screen {
  static override readonly id = "Compare-Client";
  static override readonly title = "의뢰인 — 제안 비교";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["지원 3건", "지원 1건", "이전 명세 기준", "임시 계약 중", "결렬 후 선택 중", "지원 0건 · 마감", "거절 확인", "거절함"], "default": "지원 3건", "section": "상태"}};


  renderVals(): Values {
    const view0 = this.props.view ?? '지원 3건';
    const rejM = view0 === '거절 확인', rejDone = view0 === '거절함';
    const view = rejM || rejDone ? '지원 3건' : view0;
    const stale = view === '이전 명세 기준';
    const held = view === '임시 계약 중';
    const broke = view === '결렬 후 선택 중';
    const zero = view === '지원 0건 · 마감';
    const won = (n: number) => n.toLocaleString('ko-KR') + '원';
    // 지원 순서대로. 금액은 공급자가 적은 견적 총액(수수료 전) — 카드에 보이는 유일한 금액
    const all = [
      { id: 'cjh', ini: '최', name: '최준호', career: '경력 5년', rating: '4.8', reviews: '리뷰 12건', applied: '10월 29일 지원',
        amt: 3100000, chg: '채팅에서 수정 · 처음 3,000,000원', chat: true, unread: 1,
        qn: 2, summary: '소규모 식당 예약 사이트 12곳을 만들었습니다. 예약 달력과 PG 결제 연동 작업이 대부분이고, 가장 최근 작업은 회차제 코스 레스토랑의 예약 사이트입니다.' },
      { id: 'ksr', ini: '김', name: '김세라', career: '경력 7년', rating: '4.6', reviews: '리뷰 21건', applied: '10월 30일 지원',
        amt: 4400000, chg: '', chat: true, unread: 0,
        qn: 1, summary: '카페 · 베이커리 웹사이트와 예약 시스템 9건. 디자인부터 개발까지 혼자 맡고, 문자 알림 연동 사례가 여러 건 있습니다.' },
      { id: 'nut', ini: '넛', name: '스튜디오 넛', career: '제작사 · 경력 9년', rating: '—', reviews: '리뷰 없음', applied: '11월 1일 지원',
        amt: 4500000, chg: '', chat: false, unread: 0, summary: '', links: 2 }
    ];
    let list = all;
    if (view === '지원 1건') list = [all[1]];
    if (broke) list = all.slice(1);
    if (zero) list = [];
    const sups = list.map(p => {
      const chosen = held && p.id === 'cjh';
      const gone = rejDone && p.id === 'ksr';
      const locked = (held && !chosen) || stale || gone;
      let chip = '', chipCls = 'chip';
      if (chosen) { chip = '임시 계약 · 서명 대기'; chipCls = 'chip amber'; }
      else if (held) { chip = '보류'; chipCls = 'chip'; }
      else if (stale) { chip = '이전 명세 기준'; chipCls = 'chip out'; }
      if (gone) { chip = '직접 거절'; chipCls = 'chip out'; }
      const why = gone ? '11월 2일 거절함 · 되돌릴 수 없습니다' : held && !chosen ? '임시 계약이 끝나야 계약할 수 있습니다' : (stale ? '새 견적이 들어오면 계약할 수 있습니다' : '');
      return {
        ini: p.ini, name: p.name, career: p.career, reviews: p.reviews, applied: p.applied,
        rating: p.rating === '—' ? '평점 없음' : p.rating, hasRating: p.rating !== '—',
        hasSum: !!p.summary, noSum: !p.summary, summary: p.summary, linkCnt: p.links || 0,
        total: won(p.amt), withFee: won(p.amt + Math.floor(p.amt * 0.05)), chg: p.chg,
        chatLabel: gone ? '채팅 보기 (읽기 전용)' : '문의하기 (채팅)', unread: p.unread || '', qn: p.qn || 0, hasQ: !!p.qn && !held && !gone,
        cls: 'sc' + ((held && !chosen) || gone ? ' hold' : ''),
        chip: chip, chipCls: chipCls, why: why,
        canAct: !chosen && !locked, chosen: chosen, locked: locked
      };
    });
    const n = list.length;
    return {
      h1: n === 1 ? '받은 견적' : '제안 비교', rejM: rejM, rejDone: rejDone, subRej: rejDone ? ' · 거절 1건' : '', rejName: '김세라',
      nApp: n, stale: stale, held: held, broke: broke, zero: zero, notZero: !zero,
      deadChip: zero ? '모집 마감 · 11월 3일' : broke ? '선택 기간 · 11월 17일까지' : (held ? '마감 11월 3일 · 임시 계약 중' : '마감 11월 3일 · 2일 남음'),
      sups: sups
    };
  }
}
