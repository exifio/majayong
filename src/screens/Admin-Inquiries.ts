import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 운영자 — 1:1 문의 */
export default class AdminInquiriesScreen extends Screen {
  static override readonly id = "Admin-Inquiries";
  static override readonly title = "운영자 — 1:1 문의";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["답변 대기", "답변 작성", "답변 보냄", "답변 완료 탭"], "default": "답변 대기", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '답변 대기';
    const write = v === '답변 작성', sent = v === '답변 보냄', doneTab = v === '답변 완료 탭';
    const answered = sent || doneTab;
    const ANS = "안녕하세요, 마자용 운영팀입니다.\n11월 4일 14:20 결제 건(카드 끝자리 4821)은 같은 시각 결제사 통지가 들어와 예치 완료로 처리되어 있습니다. 지금 내 계약에서도 '진행 중 · 예치 완료'로 보이고, 공급자 작업이 시작되었습니다.\n결제 직후 잠시 '확인 중'으로 보였다면 화면이 바뀌기 전이었던 것으로 보입니다. 새로고침 뒤에도 같다면 다시 문의해 주세요.";
    const W = [
      { cat: '결제 · 예치', title: '예치했는데 내 계약에 확인 중으로 나와요', who: '의뢰인 정민재 · 온도 다이닝 · 관련 계약 있음', age: '21분 전', late: false },
      { cat: '검수 · 지급', title: '중간 구간 지급 예정일이 궁금합니다', who: '공급자 최준호 · 관련 계약 있음', age: '3시간 전', late: false },
      { cat: '계정', title: '정산 계좌를 사업자 계좌로 바꾸고 싶어요', who: '공급자 한서진', age: '하루 지남', late: true },
      { cat: '이용 방법', title: '초안을 확정한 뒤에도 기능을 고칠 수 있나요?', who: '의뢰인 문지아 · 오후 세시', age: '하루 지남', late: true }
    ];
    const D = [
      { cat: '결제 · 예치', title: '예치했는데 내 계약에 확인 중으로 나와요', who: '의뢰인 정민재 · 답변 11월 4일 15:02', age: '' },
      { cat: '결제 · 예치', title: '예치 영수증은 어디서 받나요?', who: '의뢰인 정민재 · 답변 11월 4일 10:15', age: '' },
      { cat: '계정', title: '정산 계좌를 사업자 계좌로 바꿀 수 있나요?', who: '공급자 최준호 · 답변 11월 2일 16:40', age: '' }
    ];
    let list;
    if (doneTab) list = D.map(d => Object.assign(d, { status: '답변 완료', sCls: 'chip teal', ageCls: 'age' }));
    else if (sent) list = W.slice(1).map(d => Object.assign(d, { status: '답변 대기', sCls: 'chip amber', ageCls: d.late ? 'age late' : 'age' }));
    else list = W.map(d => Object.assign(d, { status: '답변 대기', sCls: 'chip amber', ageCls: d.late ? 'age late' : 'age' }));
    const items = list.map((it, i) => Object.assign(it, { cls: 'iq-li' + (i === 0 ? ' first' : '') + ((i === 0 && !sent) ? ' sel' : ''), href: doneTab ? '?view=답변+완료+탭' : '?view=답변+대기' }));
    const nWait = sent || doneTab ? 3 : 4;
    return {
      items: items, nWait: nWait, nDone: answered ? 13 : 12,
      tabWait: doneTab ? '' : 'on', tabDone: doneTab ? 'on' : '',
      justSent: sent,
      moreNote: doneTab ? '최근 30일 · 이전 답변은 검색으로 찾습니다' : '오래된 문의부터 답하면 \'하루 지남\'이 줄어듭니다',
      dChip: answered ? '답변 완료' : '답변 대기', dChipCls: answered ? 'chip teal' : 'chip amber',
      showForm: !answered, showAns: answered,
      answer: (write || answered) ? ANS : '',
      canSend: write, cantSend: !write && !answered
    };
  }
}
