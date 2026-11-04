import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 납품 */
export default class DeliverSupplierScreen extends Screen {
  static override readonly id = "Deliver-Supplier";
  static override readonly title = "공급자 — 납품";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["중간 납품", "제출함 · 검수 대기", "보완 요청", "최종 납품", "마감 지남", "정산 계좌 없음", "도움 요청", "도움 요청 보냄"], "default": "중간 납품", "section": "상태"}};


  renderVals(): Values {
    type Prog = [string, string, string];
    const v = this.props.view ?? '중간 납품';
    // '제출한 결과물 보기'로 펼친 항목 id(다시 누르면 접힘)
    const open: string[] = Array.isArray(this.state.open) ? this.state.open.filter((n: unknown): n is string => typeof n === 'string') : [];
    const late = v === '마감 지남', noAcct = v === '정산 계좌 없음';
    const helpM = v === '도움 요청', helpSent = v === '도움 요청 보냄';
    const fixV = v === '보완 요청' || helpM || helpSent, fin = v === '최종 납품' || late, sub = v === '제출함 · 검수 대기' || noAcct;
    const C = (q: string, a: string, un?: boolean) => ({ q: q, a: un ? '기능 설명대로 동작하는지만 봅니다' : a, un: !!un, cls: un ? 'un' : '' });
    const chip: Record<string, [string, string]> = { pre: ['chip out', '제출 전'], rev: ['chip blue', '검수 중'], ok: ['chip teal', '승인'], fix: ['chip amber', '보완 요청'], help: ['chip', '운영자 확인 중'] };
    const mk = (o: Values, st: string) => Object.assign({ chipCls: chip[st][0], chip: chip[st][1], hasFix: st === 'fix' || st === 'help', helpLink: st === 'fix', waitRow: st === 'help', edit: st === 'pre' || st === 'fix', okRow: st === 'ok', revRow: st === 'rev',
      files: [], noFile: true, link: '', memo: '', okNote: '' }, o);
    const cal = { id: 'cal', name: '예약 달력', desc: '회차별로 예약받고 정원이 차면 마감',
      conds: [C('회차 구성', '점심 1회 · 저녁 2회, 회차마다 정원 10석'), C('예약 가능 기간', '방문 30일 전부터 전날 18시까지')],
      link: 'https://test.ondo-dining.kr/admin/slots', files: ['회차설정_화면.png'], noFile: false,
      memo: '관리 화면 › 예약 설정에서 회차와 정원을 바꾼 뒤, 손님 화면에서 정원이 차면 마감되는지 확인해 주세요.' };
    const dep = { id: 'dep', name: '예약금 결제', desc: '예약할 때 예약금을 받고 환불 규정 안내',
      conds: [C('예약금 금액', '1인당 30,000원 정액, 관리 화면에서 바꿀 수 있게'), C('환불 기준', '회차마다 정한 마감 시각 전에 취소하면 전액 환불, 그 뒤에는 환불 없음')],
      link: 'https://test.ondo-dining.kr/reserve', memo: fixV ? '저녁 2부(마감 17:00) 예약을 만든 뒤 17:01 이후 취소해 보세요. 환불 버튼 대신 “환불 기간이 지났습니다”가 보입니다.' : '' ,
      files: fixV ? ['환불마감_수정.mp4'] : [], noFile: !fixV };
    const nos = { id: 'nos', name: '노쇼 기록', desc: '노쇼 손님을 기록해 다음 예약 때 표시',
      conds: [C('노쇼 판정 기준', '예약 시각 30분이 지나도 연락이 없으면 노쇼'), C('표시 방식', '', true)],
      link: 'https://test.ondo-dining.kr/admin/noshow', files: ['노쇼기록_흐름.pdf'], noFile: false, memo: '' };
    const rem = { id: 'rem', name: '리마인드 알림', desc: '예약 전날 손님에게 안내 자동 발송',
      conds: [C('발송 시점', '방문 전날 18:00'), C('발송 수단', '카카오 알림톡, 실패하면 문자')] };
    let items: Values[], prog: Prog[], bar: string[];
    if (fin) {
      items = [mk(nos, 'pre'), mk(rem, 'pre')];
      prog = [['중간', '예약 달력', 'ok'], ['중간', '예약금 결제', 'ok'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    } else if (sub) {
      items = [mk(cal, 'rev'), mk(dep, 'rev')];
      prog = [['중간', '예약 달력', 'rev'], ['중간', '예약금 결제', 'rev'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    } else if (fixV) {
      items = [mk(Object.assign({}, cal, { okNote: '11월 25일 승인 · 다시 검수하지 않습니다' }), 'ok'), mk(dep, helpSent ? 'help' : 'fix')];
      prog = [['중간', '예약 달력', 'ok'], ['중간', '예약금 결제', helpSent ? 'help' : 'fix'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    } else {
      items = [mk(cal, 'pre'), mk(dep, 'pre')];
      prog = [['중간', '예약 달력', 'pre'], ['중간', '예약금 결제', 'pre'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    }
    items = items.map(it => {
      if (!it.okRow && !it.revRow) return it;
      const id = String(it.id), isOpen = open.includes(id);
      return Object.assign({}, it, { dlOpen: isOpen, dlLabel: isOpen ? '접기' : '제출한 결과물 보기',
        when: '11월 25일 제출', memoRo: it.memo || '메모 없음',
        toggleDl: () => this.setState({ open: isOpen ? open.filter(n => n !== id) : [...open, id] }) });
    });
    const barCls: Record<string, string> = { ok: 'b-ok', rev: 'b-wait', fix: 'b-fix', help: 'b-fix', pre: 'b-pre' };
    bar = prog.map(p => barCls[p[2]]);
    const nOk = prog.filter(p => p[2] === 'ok').length;
    return {
      items: items, bar: bar, nOkItems: nOk, helpM: helpM, helpSent: helpSent,
      prog: prog.map(p => ({ g: p[0], name: p[1], chipCls: chip[p[2]][0], chip: chip[p[2]][1] })),
      barNote: sub ? '중간 구간 2건 제출 · 검수 기한 12월 2일' : late ? '중간 구간 지급 완료 · 최종 구간 미제출' : fin ? '중간 구간 지급 완료 · 최종 구간 작성 중' : (helpSent ? '중간 구간 · 승인 1건, 운영자 확인 중 1건' : fixV ? '중간 구간 · 승인 1건, 보완 요청 1건' : '중간 구간 작성 중 · 아직 제출하지 않았습니다'),
      showPaid: fin && !late, hasBand: late || noAcct, bandAcct: noAcct, bandChat: late,
      bandT: late ? '작업 마감(12월 16일)이 지났습니다' : '지급받을 계좌가 없습니다',
      bandP: late ? '납품하거나 의뢰인과 채팅으로 일정을 정하세요 · 의뢰인이 공급자 사정으로 취소를 요청할 수 있습니다.' : '승인되어도 계좌를 등록해야 지급됩니다 · 계정 설정 › 정산 정보에서 등록하세요.',
      ddTxt: late ? '12월 16일까지 · 2일 지남' : '12월 16일까지 · D-' + (fin ? 18 : (fixV || sub ? 21 : 30)),
      stChip: helpSent ? '운영자 확인 중' : sub ? '검수 대기' : late ? '마감 지남 · 최종 미제출' : fin ? '최종 구간 작성 중' : (fixV ? '보완 요청 1건' : '중간 구간 작성 중'),
      stChipCls: helpSent ? 'chip' : fixV || late ? 'chip amber' : 'chip blue',
      tabMid: fin ? '' : 'on', tabFin: fin ? 'on' : '',
      midChip: helpSent ? '운영자 확인 중' : sub ? '검수 중' : fin ? '지급 완료' : (fixV ? '보완 요청' : '작성 중'), midChipCls: fin ? 'chip teal' : helpSent ? 'chip' : (fixV ? 'chip amber' : 'chip blue'),
      finChip: late ? '마감 지남' : fin ? '작성 중' : '중간 뒤', finChipCls: late ? 'chip amber' : fin ? 'chip blue' : 'chip out',
      sbmLabel: helpSent ? '판정 기다리는 중' : sub ? '검수 기다리는 중' : fin ? '최종 납품 제출' : (fixV ? '다시 제출' : '중간 납품 제출'), sbmOn: !sub && !helpSent, sbmOff: sub || helpSent,
      sbmNote: helpSent ? '예약금 결제는 운영자 판정이 나온 뒤 판정에 따라 다시 제출하거나 그대로 검수받습니다.' : sub ? '11월 25일 제출했습니다. 의뢰인 검수 기한 12월 2일 · 지나면 자동 승인되고 지급됩니다. 검수가 끝나기 전에는 고칠 수 없습니다.' : late ? '마감이 지났어도 지금 제출할 수 있습니다. 제출하면 의뢰인 \'내 계약\'에 검수 대기로 표시되고, 검수 기한은 제출일부터 7일입니다.' : fin ? '노쇼 기록과 리마인드 알림을 함께 제출합니다. 제출하면 의뢰인 \'내 계약\'에 검수 대기로 표시됩니다.'
           : (fixV ? '예약금 결제만 다시 제출합니다. 승인되면 중간 구간 금액이 지급됩니다.' : '예약 달력과 예약금 결제를 함께 제출합니다. 제출하면 의뢰인 \'내 계약\'에 검수 대기로 표시됩니다.'),
      payTitle: fin ? '최종 구간 지급 예정' : '이번 구간 지급 예정', payStage: fin ? '최종' : '중간',
      payNote: noAcct ? '두 항목이 모두 승인되면 지급되지만, 정산 계좌가 등록되어 있어야 보낼 수 있습니다. 등록 전까지 지급은 보류됩니다.' : fin ? '노쇼 기록과 리마인드 알림이 모두 승인되면 지급되고, 계약이 완료됩니다. 원 단위 끝수는 최종 지급에 더합니다.'
                   : '예약 달력과 예약금 결제가 모두 승인되면 지급됩니다. 한 항목만 승인되어서는 지급되지 않습니다.'
    };
  }
}
