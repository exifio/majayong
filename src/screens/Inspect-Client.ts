import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 검수 */
export default class InspectClientScreen extends Screen {
  static override readonly id = "Inspect-Client";
  static override readonly title = "의뢰인 — 검수";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["검수 대기", "보완 요청 작성", "승인 확인", "최종 검수", "도움 요청", "중간 승인 완료", "검수 기한 하루 전", "보완 요청 보냄", "도움 요청 보냄"], "default": "검수 대기", "section": "상태"}};


  renderVals(): Values {
    type Prog = [string, string, string];
    const v = this.props.view ?? '검수 대기';
    // 승인된 항목의 '납품물 다시 보기'로 펼친 항목 이름(다시 누르면 접힘)
    const open: string[] = Array.isArray(this.state.open) ? this.state.open.filter((n: unknown): n is string => typeof n === 'string') : [];
    const fixV = v === '보완 요청 작성', conf = v === '승인 확인', fin = v === '최종 검수', midDone = v === '중간 승인 완료', due = v === '검수 기한 하루 전';
    const fixSent = v === '보완 요청 보냄', helpSent = v === '도움 요청 보냄', sent = fixSent || helpSent;
    const C = (q: string, a: string, un?: boolean) => ({ q: q, a: un ? '기능 설명대로 동작하는지만 봅니다' : a, un: !!un, cls: un ? 'un' : '' });
    const chip: Record<string, [string, string]> = { pre: ['chip out', '납품 전'], wait: ['chip blue', '검수 대기'], ok: ['chip teal', '승인'], fix: ['chip amber', '보완 요청함'], help: ['chip', '운영자 확인 중'] };
    const mk = (o: Values, st: string, extra?: Values) => Object.assign({ chipCls: chip[st][0], chip: chip[st][1], showDl: st !== 'pre', acts: st === 'wait',
      okRow: st === 'ok', waitRow: st === 'fix' || st === 'help', wT: '', wD: '', wQ: '', fixForm: false, files: [], noFile: true, memo: '', okNote: '', when: '' }, o, extra || {});
    const cal = { name: '예약 달력', desc: '회차별로 예약받고 정원이 차면 마감',
      conds: [C('회차 구성', '점심 1회 · 저녁 2회, 회차마다 정원 10석'), C('예약 가능 기간', '방문 30일 전부터 전날 18시까지')],
      link: 'https://test.ondo-dining.kr/admin/slots', files: ['회차설정_화면.png'], noFile: false, when: '11월 25일 납품',
      memo: '관리 화면 › 예약 설정에서 회차와 정원을 바꾼 뒤, 손님 화면에서 정원이 차면 마감되는지 확인해 주세요.' };
    const dep = { name: '예약금 결제', desc: '예약할 때 예약금을 받고 환불 규정 안내',
      conds: [C('예약금 금액', '1인당 30,000원 정액, 관리 화면에서 바꿀 수 있게'), C('환불 기준', '회차마다 정한 마감 시각 전에 취소하면 전액 환불, 그 뒤에는 환불 없음')],
      link: 'https://test.ondo-dining.kr/reserve', when: '11월 25일 납품', memo: '메모 없음' };
    const dep2 = Object.assign({}, dep, { files: ['환불마감_수정.mp4'], noFile: false, when: '11월 26일 다시 납품 · 보완 1회',
      memo: '저녁 2부(마감 17:00) 예약을 만든 뒤 17:01 이후 취소해 보세요. 환불 버튼 대신 “환불 기간이 지났습니다”가 보입니다.' });
    const nos = { name: '노쇼 기록', desc: '노쇼 손님을 기록해 다음 예약 때 표시',
      conds: [C('노쇼 판정 기준', '예약 시각 30분이 지나도 연락이 없으면 노쇼'), C('표시 방식', '', true)],
      link: 'https://test.ondo-dining.kr/admin/noshow', files: ['노쇼기록_흐름.pdf'], noFile: false, when: '12월 12일 납품',
      memo: '관리 화면 › 예약 목록에서 지난 예약을 노쇼로 표시한 뒤, 같은 손님이 다시 예약하면 표시가 붙는지 확인해 주세요.' };
    const rem = { name: '리마인드 알림', desc: '예약 전날 손님에게 안내 자동 발송',
      conds: [C('발송 시점', '방문 전날 18:00'), C('발송 수단', '카카오 알림톡, 실패하면 문자')],
      link: 'https://test.ondo-dining.kr/admin/remind', when: '12월 12일 납품',
      memo: '관리 화면 › 알림 기록에서 테스트 발송을 눌러 보세요. 알림톡이 실패하면 문자로 바뀐 기록이 남습니다.' };
    let items: Values[], prog: Prog[];
    if (midDone) {
      items = [mk(cal, 'ok', { okNote: '11월 25일 승인 · 다시 검수하지 않습니다' }), mk(dep2, 'ok', { okNote: '11월 27일 승인 · 보완 1회 · 다시 검수하지 않습니다' })];
      prog = [['중간', '예약 달력', 'ok'], ['중간', '예약금 결제', 'ok'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    } else if (fin) {
      items = [mk(nos, 'wait'), mk(rem, 'wait')];
      prog = [['중간', '예약 달력', 'ok'], ['중간', '예약금 결제', 'ok'], ['최종', '노쇼 기록', 'wait'], ['최종', '리마인드 알림', 'wait']];
    } else if (fixV) {
      items = [mk(cal, 'ok', { okNote: '11월 25일 승인 · 다시 검수하지 않습니다' }), mk(dep, 'wait', { acts: false, fixForm: true, chipCls: 'chip amber', chip: '보완 요청 작성 중' })];
      prog = [['중간', '예약 달력', 'ok'], ['중간', '예약금 결제', 'wait'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    } else if (fixSent) {
      items = [mk(cal, 'ok', { okNote: '11월 25일 승인 · 다시 검수하지 않습니다' }),
               mk(dep, 'fix', { wT: '보완 요청함 · 11월 25일 18:20', wD: '조건과 다름 · 환불 기준 · 다시 납품되면 이 항목만 다시 검수합니다',
                 wQ: '저녁 2부 회차는 마감 시각이 지나도 환불 버튼이 보여요. 회차마다 정한 마감 시각 이후에는 환불이 안 되게 해 주세요.' })];
      prog = [['중간', '예약 달력', 'ok'], ['중간', '예약금 결제', 'fix'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    } else if (helpSent) {
      items = [mk(cal, 'ok', { okNote: '11월 25일 승인 · 다시 검수하지 않습니다' }),
               mk(dep2, 'help', { wT: '운영자에게 도움 요청함 · 11월 27일 10:05', wD: '판정 전까지 이 항목의 검수와 자동 승인은 멈춥니다. 판정은 채팅과 내 계약에 남습니다.' })];
      prog = [['중간', '예약 달력', 'ok'], ['중간', '예약금 결제', 'help'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    } else if (conf) {
      items = [mk(cal, 'ok', { okNote: '11월 25일 승인 · 다시 검수하지 않습니다' }), mk(dep2, 'wait')];
      prog = [['중간', '예약 달력', 'ok'], ['중간', '예약금 결제', 'wait'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    } else {
      items = [mk(cal, 'wait'), mk(dep, 'wait')];
      prog = [['중간', '예약 달력', 'wait'], ['중간', '예약금 결제', 'wait'], ['최종', '노쇼 기록', 'pre'], ['최종', '리마인드 알림', 'pre']];
    }
    items = items.map(it => {
      if (!it.okRow) return it;
      const name = String(it.name), isOpen = open.includes(name);
      return Object.assign({}, it, { showDl: isOpen, dlOpen: isOpen, dlLabel: isOpen ? '접기' : '납품물 다시 보기',
        toggleDl: () => this.setState({ open: isOpen ? open.filter(n => n !== name) : [...open, name] }) });
    });
    const barCls: Record<string, string> = { ok: 'b-ok', wait: 'b-wait', fix: 'b-fix', help: 'b-fix', pre: 'b-pre' };
    const nOk = prog.filter(p => p[2] === 'ok').length;
    const stageOk = prog.filter(p => p[0] === (fin ? '최종' : '중간') && p[2] === 'ok').length;
    return {
      sent: sent,
      sentT: fixSent ? '예약금 결제 보완 요청을 보냈습니다 · 11월 25일 18:20' : '운영자에게 도움 요청을 보냈습니다 · 11월 27일 10:05',
      sentP: fixSent ? '최준호님에게 사유(조건과 다름 · 환불 기준)와 남길 말이 전달되었습니다. 다시 납품되면 알림이 오고, 그때부터 검수 기한 7일이 새로 시작됩니다.'
                     : '운영자가 조건 줄과 보완 요청 이력을 보고 판정합니다. 최준호님에게도 도움 요청이 알려졌습니다. 판정이 나오면 알림이 옵니다.',
      items: items, bar: prog.map(p => barCls[p[2]]), nOkItems: nOk, modal: conf, helpM: v === '도움 요청',
      prog: prog.map(p => ({ g: p[0], name: p[1], chipCls: chip[p[2]][0], chip: chip[p[2]][1] })),
      progCnt: midDone ? '중간 구간 2건 모두 승인 · 최종 구간 납품 전' : (fin ? '최종' : '중간') + ' 구간 · 2건 중 ' + stageOk + '건 승인',
      barNote: midDone ? '중간 구간 지급 완료 · 최종 구간 작업 중' : fin ? '중간 구간 지급 완료 · 최종 구간 검수 대기' : fixSent ? '중간 구간 · 승인 1건, 보완 요청 1건' : helpSent ? '중간 구간 · 승인 1건, 운영자 확인 중 1건' : (fixV || conf ? '중간 구간 · 승인 1건, 검수 대기 1건' : '중간 구간 · 11월 25일 납품 · 검수 대기 2건'),
      isFinal: fin, showPaid: fin || midDone, isDue: due, dday: fin ? 4 : (midDone ? 19 : (due ? 15 : 21)),
      hasDl: !midDone && !sent, dlDate: fin ? '12월 19일' : (conf ? '12월 3일' : '12월 2일'),
      stChip: midDone ? '중간 구간 승인 완료' : fixSent ? '다시 납품 기다리는 중' : helpSent ? '운영자 확인 중' : (fin ? '최종 구간 검수 대기' : (fixV ? '보완 요청 작성 중' : '중간 구간 검수 대기')),
      stChipCls: midDone ? 'chip teal' : sent ? 'chip' : (fixV || due ? 'chip amber' : 'chip blue'),
      tabMid: fin ? '' : 'on', tabFin: fin ? 'on' : '',
      midChip: fin || midDone ? '지급 완료' : fixSent ? '보완 요청 중' : helpSent ? '운영자 확인 중' : '검수 대기', midChipCls: fin || midDone ? 'chip teal' : fixSent ? 'chip amber' : helpSent ? 'chip' : 'chip blue',
      finChip: fin ? '검수 대기' : (midDone ? '작업 중 · 납품 기다리는 중' : '납품 전'), finChipCls: fin ? 'chip blue' : 'chip out',
      payTitle: midDone ? '중간 구간 지급 완료' : (fin ? '최종 구간 지급 예정' : '이번 구간 지급 예정'), payStage: fin ? '최종' : '중간',
      payNote: midDone ? '11월 27일 최준호님에게 지급되었습니다. 최종 구간(노쇼 기록 · 리마인드 알림)은 납품되면 검수할 수 있습니다.' : fin ? '노쇼 기록과 리마인드 알림을 모두 승인하면 지급되고 계약이 완료됩니다. 원 단위 끝수는 최종 지급에 더합니다.'
                   : '예약 달력과 예약금 결제를 모두 승인하면 최준호님에게 지급됩니다. 한 항목만 승인해서는 지급되지 않습니다.'
    };
  }
}
