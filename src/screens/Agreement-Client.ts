import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 최종 합의 내용 확인 */
export default class AgreementClientScreen extends Screen {
  static override readonly id = "Agreement-Client";
  static override readonly title = "의뢰인 — 최종 합의 내용 확인";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"state": {"editor": "enum", "options": ["미정 있음", "모두 정해짐", "첫 문장 기능 빠짐", "근거 보기"], "default": "모두 정해짐", "section": "상태"}};


  renderVals(): Values {
    const v0 = this.props.state ?? '모두 정해짐';
    const popV = v0 === '근거 보기';
    const v = popV ? '미정 있음' : v0;
    const open = v === '미정 있음';
    const dropped = v === '첫 문장 기능 빠짐';
    // 조건: [이름, 정해진 문장, 미정 있음일 때 상태(ok/pr/no), 근거 수, 제안자]
    type Cond = [string, string, string, number, string?];
    type Fn = { name: string; desc: string; stage: string; first?: boolean; conds: Cond[] };
    const F: Fn[] = [
      { name: '예약 달력', desc: '회차별로 예약받고 정원이 차면 마감', stage: '중간', conds: [
        ['회차 구성', '점심 1회 · 저녁 2회, 회차마다 정원 10석', 'no', 2],
        ['예약 가능 기간', '방문 30일 전부터 전날 18시까지', 'no', 1] ] },
      { name: '예약금 결제', desc: '예약할 때 예약금을 받고 환불 규정 안내', stage: '중간', conds: [
        ['예약금 금액', '1인당 30,000원 정액, 관리 화면에서 바꿀 수 있게', 'pr', 2, '내가 제안 · 최준호님이 아직 답하지 않음'],
        ['환불 기준', '회차마다 정한 마감 시각 전에 취소하면 전액 환불, 그 뒤에는 환불 없음', 'ok', 3] ] },
      { name: '노쇼 기록', desc: '노쇼 손님을 기록해 다음 예약 때 표시', stage: '최종', first: true, conds: [
        ['노쇼 판정 기준', '예약 시각 30분이 지나도 연락이 없으면 노쇼', 'pr', 2, '최준호님 제안 · 아직 답하지 않음'],
        ['표시 방식', '다음 예약 때 관리 화면에 노쇼 횟수 표시', 'no', 1] ] },
      { name: '리마인드 알림', desc: '예약 전날 손님에게 안내 자동 발송', stage: '최종', conds: [
        ['발송 시점', '방문 전날 18:00', 'ok', 2],
        ['발송 수단', '카카오 알림톡, 실패하면 문자', 'ok', 2] ] }
    ];
    const chipOf: Record<string, [string, string]> = { ok: ['chip teal', '정해짐'], pr: ['chip', '한쪽 제안'], no: ['chip out', '아직 안 정함'] };
    let nOpen = 0;
    const fns = F.map(f => {
      const gone = dropped && f.first;
      const conds = f.conds.map((c, i) => {
        const st = open ? c[2] : 'ok';
        if (!gone && st !== 'ok') nOpen++;
        const pop = popV && c[0] === '환불 기준';
        return { pop: pop, cls: 'cr' + (i === 0 ? ' first' : '') + (st !== 'ok' ? ' open' : '') + (pop ? ' popon' : ''), q: c[0], text: c[1],
          src: 'AI 정리 · 근거 ' + c[3] + '건', who: c[4] || '',
          isOk: st === 'ok', isPr: st === 'pr', isNo: st === 'no', chipCls: chipOf[st][0], chip: chipOf[st][1] };
      });
      return { name: f.name, desc: f.desc, cls: 'fc' + (gone ? ' gone' : ''), keep: !gone, gone: gone, stage: f.stage, conds: conds };
    });
    return {
      nAllCond: dropped ? 8 : 10,
      stageAmt: dropped ? '1,400,000원' : '1,550,000원',
      finalAmt: dropped ? '2,800,000원' : '3,100,000원',
      finalSub: dropped ? '3회차 · 노쇼 기록을 빼며 채팅에서 수정' : '2회차 · 11월 1일 채팅에서 수정',
      feeAmt: dropped ? '140,000원' : '155,000원', totAmt: dropped ? '2,940,000원' : '3,255,000원',
      fns: fns, open: open, allDone: !open, dropped: dropped, nOpen: nOpen + (open ? 2 : 0),
      payChip: open ? '아직 안 정함' : '정해짐', payChipCls: open ? 'chip out' : 'chip teal',
      payNote: open ? '채팅에서 정하지 않아 기본값이 들어갑니다 — 비율 50 : 50, 구간은 명세 순서대로. 바꾸려면 채팅에서 정해 주세요(10~90%).' : '채팅에서 정한 구간과 비율입니다 · AI 정리 · 근거 2건',
      midNames: '예약 달력, 예약금 결제', finNames: dropped ? '리마인드 알림' : '노쇼 기록, 리마인드 알림',
      hasWhy: open || dropped,
      why: dropped ? '노쇼 기록은 이번 계약 범위에 들어가지 않습니다.' : '세부 조건 ' + nOpen + '건은 계약서에 \'정하지 않음\'으로 남고(기능만 검수), 지급 구간 · 비율은 기본값이 들어갑니다.'
    };
  }
}
