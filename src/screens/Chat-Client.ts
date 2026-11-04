import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 문의 채팅 */
export default class ChatClientScreen extends Screen {
  static override readonly id = "Chat-Client";
  static override readonly title = "의뢰인 — 문의 채팅";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["문의 중", "처음 문의", "임시 계약 중", "읽기 전용", "이전 명세 기준", "계약 체결 후", "신고"], "default": "문의 중", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '문의 중';
    const isNew = v === '처음 문의', ro = v === '읽기 전용', stale = v === '이전 명세 기준', signed = v === '계약 체결 후';
    const held = v === '임시 계약 중' || signed;
    const report = v === '신고';
    type Person = { id: string; ini: string; name: string; meta: string; amt: string; days: string; ok: string };
    const S: Record<'cjh' | 'ksr' | 'nut', Person> = {
      cjh: { id: 'cjh', ini: '최', name: '최준호', meta: '경력 5년 · ★ 4.8 · 리뷰 12건', amt: '3,100,000원', days: '42일', ok: '4 / 4' },
      ksr: { id: 'ksr', ini: '김', name: '김세라', meta: '경력 7년 · ★ 4.6 · 리뷰 21건', amt: '4,400,000원', days: '35일', ok: '4 / 4' },
      nut: { id: 'nut', ini: '넛', name: '스튜디오 넛', meta: '제작사 · 경력 9년 · 리뷰 없음', amt: '4,500,000원', days: '56일', ok: '3 / 4' }
    };
    // 왼쪽 목록 — 최근 대화 순
    const row = (s: Person, o: Values) => Object.assign({ id: s.id, ini: s.ini, name: s.name, cls: 'it', chip: '문의 중', chipCls: 'chip blue', unread: '' }, o);
    let list, cur;
    if (ro) {
      list = [row(S.ksr, { cls: 'it on', time: '11월 4일', preview: '전날 취소는 전액 환불로 두는 게 좋겠습니다', chip: '자동 거절', chipCls: 'chip' }),
              row(S.cjh, { time: '11월 4일', preview: '계약이 체결되었습니다', chip: '계약 체결', chipCls: 'chip teal' })];
      cur = Object.assign({}, S.ksr, { chip: '자동 거절', chipCls: 'chip' });
    } else {
      const c1 = row(S.cjh, { cls: isNew ? 'it' : 'it on', time: held ? '09:30' : '09:12', preview: held ? '최종 합의 내용으로 임시 계약이 되었습니다' : report ? '마자용 밖에서 직접 계약하시면 수수료 없이…' : '노쇼 판정 기준도 정해 두면 좋겠습니다',
        unread: held || !isNew ? '' : 1, chip: held ? '임시 계약' : '문의 중', chipCls: held ? 'chip amber' : 'chip blue' });
      if (!held && !isNew) c1.unread = '';
      const c2 = row(S.ksr, { time: '11월 2일', preview: '전날 취소는 전액 환불로 두는 게 좋겠습니다', chip: held ? '보류' : '문의 중', chipCls: held ? 'chip' : 'chip blue' });
      list = [c1, c2];
      if (isNew) list.unshift(row(S.nut, { cls: 'it on', time: '지금', preview: '아직 메시지가 없습니다', chip: '문의 전', chipCls: 'chip out' }));
      cur = isNew ? Object.assign({}, S.nut, { chip: '문의 전', chipCls: 'chip out' })
                  : Object.assign({}, S.cjh, signed ? { chip: '계약 체결', chipCls: 'chip teal' } : (held ? { chip: '임시 계약 · 서명 대기', chipCls: 'chip amber' } : (stale ? { chip: '이전 명세 기준', chipCls: 'chip out' } : { chip: '문의 중', chipCls: 'chip blue' })));
      if (signed) { c1.chip = '계약 체결'; c1.chipCls = 'chip teal'; c1.time = '11월 4일'; c1.preview = '감사합니다. 중간 납품은 11월 25일로…'; c2.chip = '자동 거절'; c2.chipCls = 'chip'; }
      if (stale) { c1.chip = '이전 명세 기준'; c1.chipCls = 'chip out'; c2.chip = '이전 명세 기준'; c2.chipCls = 'chip out'; }
    }
    // 기능마다 태그 하나 — 안의 조건 상태를 묶어 보여 준다. 마지막은 지급 구간 · 비율(기능 아님, 계약 조건)
    type FnTag = [string, string[]];
    const T: FnTag[] = [['예약 달력',['회차 구성','예약 가능 기간']],['예약금 결제',['예약금 금액','환불 기준']],['노쇼 기록',['노쇼 판정 기준','표시 방식']],['리마인드 알림',['발송 시점','발송 수단']],['지급 구간 · 비율',['기능별 지급 구간','중간 · 최종 비율']]];
    // 문의 중: 환불 기준 · 발송 시점 · 발송 수단 합의, 예약금 금액(내 제안) · 노쇼 판정(공급자 제안) 한쪽 제안, 지급은 아직
    let st: string[] = ['no','no','pr','ok','pr','no','ok','ok','no','no'];
    if (isNew) st = st.map(() => 'no');
    if (held) st = st.map((x, i) => i === 5 ? 'no' : 'ok'); // 노쇼 '표시 방식'은 정하지 않음
    if (ro) st = ['no','no','no','ok','no','no','pr','no','no','no'];
    // 처음 문의(스튜디오 넛): 리마인드 알림은 불가 항목이라 정할 것에서 뺀다 → 8건
    let TT = T;
    if (isNew) { TT = T.filter(t => t[0] !== '리마인드 알림'); st = st.slice(0, 8); }
    const lbl: Record<string, string> = { ok: '정해짐', pr: '한쪽 제안', no: '아직 안 정함' };
    let k = 0;
    const tags = TT.map(t => {
      const ss = t[1].map(() => st[k++]);
      const done = ss.filter(x => x === 'ok').length;
      const cls = done === ss.length ? 'ok' : (ss.every(x => x === 'no') ? 'no' : 'pr');
      return { fn: t[0], done: done, total: ss.length, cls: cls, mark: { ok: '✓', pr: '●', no: '' }[cls],
        tip: t[1].map((n, i) => n + ' — ' + lbl[ss[i]]).join(' · ') };
    });
    const cnt = (c: string) => tags.filter(x => x.cls === c).length;
    return {
      tags: tags, nOk: cnt('ok'), nPr: cnt('pr'), nNo: cnt('no'), nAll: st.length, nDone: st.filter(x => x === 'ok').length,
      stamp: isNew ? '' : (signed ? '11월 4일 14:41 기준' : (held ? '11월 3일 09:30 기준' : '11월 3일 09:15 기준')),
      list: list, cur: cur,
      isNew: isNew, hasThread: !isNew, mainThread: !isNew && !ro, roThread: ro, isHeld: held, readOnly: ro,
      canPick: !held && !ro && !stale, canWrite: !ro, showNew: v === '문의 중', report: report, noReport: !report, flagCls: report ? 'm flag' : 'm', showRev: !ro, stale: stale, signed: signed, showContract: held,
      hint: signed ? '계약이 체결되어 이제 연락처가 가려지지 않습니다. 견적은 더 이상 고칠 수 없습니다.' : '계약 체결 전에는 연락처가 자동으로 가려집니다. 견적은 공급자만 고칠 수 있고, 고치면 이 대화에 기록이 남습니다.',
      ph: isNew ? '스튜디오 넛님에게 첫 메시지를 보내 보세요' : '메시지를 입력하세요'
    };
  }
}
