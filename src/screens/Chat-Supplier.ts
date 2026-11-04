import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 문의 채팅 */
export default class ChatSupplierScreen extends Screen {
  static override readonly id = "Chat-Supplier";
  static override readonly title = "공급자 — 문의 채팅";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["문의 중", "견적 수정", "임시 계약", "읽기 전용", "계약 체결 후", "신고"], "default": "문의 중", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '문의 중';
    const rpt = v === '신고';
    const rev = v === '견적 수정', held = v === '임시 계약', ro = v === '읽기 전용', sgn = v === '계약 체결 후';
    type Party = { id: string; ini: string; name: string; biz: string; pj: string };
    const C = {
      jmj: { id: 'jmj', ini: '정', name: '정민재', biz: '온도 다이닝', ind: '음식점(코스 레스토랑)', pj: '예약 달력, 예약금 결제 외 2개 기능', round: '2회차', amt: '3,100,000원', days: '42일', ok: '4 / 4', rcv: '2,945,000원' },
      dsk: { id: 'dsk', ini: '김', name: '김도담', biz: '담소 키친', pj: '회차 예약, 알레르기 사전 접수 외 2개 기능' },
      hsy: { id: 'hsy', ini: '서', name: '서하루', biz: '하루 베이커리', ind: '베이커리', pj: '전화 예약 대체, 대기 명단 외 1개 기능', round: '1회차', amt: '1,500,000원', days: '21일', ok: '2 / 2', rcv: '1,425,000원' }
    };
    const row = (c: Party, o: Values) => Object.assign({ id: c.id, ini: c.ini, name: c.name + ' · ' + c.biz, pj: c.pj, cls: 'it', chip: '문의 중', chipCls: 'chip blue', unread: '' }, o);
    const list = [
      row(C.dsk, { time: '11월 1일', preview: '알레르기 정보는 예약할 때 받을 수 있나요?' }),
      row(C.jmj, { cls: ro ? 'it' : 'it on', unread: ro ? 1 : '', time: sgn ? '16:32' : (held ? '09:30' : '09:12'), preview: sgn ? '내일부터 예약 달력부터 작업하겠습니다' : (held ? '최종 합의를 마쳐 임시 계약이 되었습니다' : '노쇼 판정 기준도 정해 두면 좋겠습니다'),
        chip: sgn ? '계약 체결' : (held ? '임시 계약' : '문의 중'), chipCls: sgn ? 'chip teal' : (held ? 'chip amber' : 'chip blue') }),
      row(C.hsy, { cls: ro ? 'it on' : 'it', time: '10월 30일', preview: '대기 명단은 문자로 순서를 알려 주면 좋겠어요', chip: '자동 거절', chipCls: 'chip' })
    ];
    const cur = ro ? Object.assign({}, C.hsy, { chip: '자동 거절', chipCls: 'chip' })
                   : Object.assign({}, C.jmj, sgn ? { chip: '계약 체결', chipCls: 'chip teal' } : held ? { chip: '임시 계약 · 서명 대기', chipCls: 'chip amber' } : { chip: '문의 중', chipCls: 'chip blue' });
    // 의뢰인 화면과 같은 AI 태그 — 기능마다 하나, 마지막은 지급 구간 · 비율
    type FnTag = [string, string[]];
    let T: FnTag[] = [['예약 달력',['회차 구성','예약 가능 기간']],['예약금 결제',['예약금 금액','환불 기준']],['노쇼 기록',['노쇼 판정 기준','표시 방식']],['리마인드 알림',['발송 시점','발송 수단']],['지급 구간 · 비율',['기능별 지급 구간','중간 · 최종 비율']]];
    let st: string[] = ['no','no','pr','ok','pr','no','ok','ok','no','no'];
    if (held || sgn) st = st.map((x, i) => i === 5 ? 'no' : 'ok'); // 노쇼 '표시 방식'은 정하지 않은 채 합의(계약서에 '정하지 않음')
    if (ro) {
      T = [['전화 예약 대체',['예약 접수 방식','접수 마감']],['대기 명단',['순서 알림 방식','대기 인원 상한']],['지급 구간 · 비율',['기능별 지급 구간','중간 · 최종 비율']]];
      st = ['ok','pr','no','no','no','no'];
    }
    const lbl: Record<string, string> = { ok: '정해짐', pr: '한쪽 제안', no: '아직 안 정함' };
    let k = 0;
    const tags = T.map(t => {
      const ss = t[1].map(() => st[k++]);
      const done = ss.filter(x => x === 'ok').length;
      const cls = done === ss.length ? 'ok' : (ss.every(x => x === 'no') ? 'no' : 'pr');
      return { fn: t[0], done: done, total: ss.length, cls: cls, mark: { ok: '✓', pr: '●', no: '' }[cls],
        tip: t[1].map((n, i) => n + ' — ' + lbl[ss[i]]).join(' · ') };
    });
    const cnt = (c: string) => tags.filter(x => x.cls === c).length;
    return {
      rpOpen: rpt, flagCls: rpt ? 'm flag' : 'm',
      tags: tags, nOk: cnt('ok'), nPr: cnt('pr'), nNo: cnt('no'), nAll: st.length, nDone: st.filter(x => x === 'ok').length,
      stamp: ro ? '10월 30일 기준' : (sgn ? '11월 4일 16:05 기준' : (held ? '11월 3일 09:30 기준' : '11월 3일 09:15 기준')),
      list: list, cur: cur,
      main: !ro, isHeld: held, isSigned: sgn, heldMsgs: held || sgn, readOnly: ro, revOpen: rev,
      canRev: !held && !ro && !sgn, canWrite: !ro,
      hint: sgn ? '계약이 체결되어 연락처를 주고받을 수 있습니다. 납품과 검수는 내 계약 › 납품에서 합니다.' : held ? '서명 전까지 대화를 이어갈 수 있습니다. 계약 체결 전에는 연락처가 자동으로 가려집니다.'
                 : '계약 체결 전에는 연락처가 자동으로 가려집니다. 금액 · 기간을 바꾸려면 위의 \'견적 수정\'을 쓰세요 — 이 대화에 기록이 남습니다.'
    };
  }
}
