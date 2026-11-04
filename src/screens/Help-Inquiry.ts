import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공통 — 1:1 문의 */
export default class HelpInquiryScreen extends Screen {
  static override readonly id = "Help-Inquiry";
  static override readonly title = "공통 — 1:1 문의";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"who": {"editor": "enum", "options": ["의뢰인", "공급자", "비로그인"], "default": "의뢰인", "section": "상태"}, "view": {"editor": "enum", "options": ["문의 작성", "문의 보냄", "내 문의"], "default": "문의 작성", "section": "상태"}};


  renderVals(): Values {
    const who = this.props.who ?? '의뢰인', v = this.props.view ?? '문의 작성';
    const guest = who === '비로그인', cl = who === '의뢰인', sp = who === '공급자';
    const form = v === '문의 작성', sent = v === '문의 보냄', myv = v === '내 문의';
    const types = ['이용 방법', '결제 · 예치', '검수 · 지급', '계약 취소', '계정', '기타'].map(n => { const on = n === (cl ? '결제 · 예치' : '검수 · 지급'); return { name: n, on: on ? 'true' : 'false', cls: on ? 'on' : '' }; });
    const CB = '11월 4일 14:20에 카드로 3,255,000원을 결제했습니다.\n내 계약에는 아직 \'확인 중\'으로 보여서 문의드립니다.';
    const SB = '중간 구간 납품을 준비하고 있습니다.\n의뢰인이 승인하면 지급까지 며칠 걸리는지 알고 싶습니다.';
    const A1 = '안녕하세요, 마자용 운영팀입니다.\n11월 4일 14:20 결제 건(카드 끝자리 4821)은 같은 시각 결제사 통지가 들어와 예치 완료로 처리되어 있습니다. 지금 내 계약에서도 \'진행 중 · 예치 완료\'로 보이고, 공급자 작업이 시작되었습니다.\n결제 직후 잠시 \'확인 중\'으로 보였다면 화면이 바뀌기 전이었던 것으로 보입니다. 새로고침 뒤에도 같다면 다시 문의해 주세요.';
    const cNew = { st: '답변 대기', sCls: 'chip amber', cat: '결제 · 예치', t: '예치했는데 내 계약에 확인 중으로 나와요', d: '방금', when: '11월 4일 14:41', contract: '예약 달력, 예약금 결제 외 2개 기능 · 최준호', cHref: 'Contracts-Client.dc.html', body: CB, hasFile: true, file: '결제 문자 캡처.png · 214KB', answered: false, waiting: true, aWhen: '', answer: '' };
    const cDone = Object.assign({}, cNew, { st: '답변 완료', sCls: 'chip teal', d: '11월 4일', answered: true, waiting: false, aWhen: '11월 4일 15:02', answer: A1 });
    const sNew = { st: '답변 대기', sCls: 'chip amber', cat: '검수 · 지급', t: '중간 구간 지급 예정일이 궁금합니다', d: '방금', when: '11월 4일 11:20', contract: '예약 달력, 예약금 결제 외 2개 기능 · 온도 다이닝', cHref: 'Contracts-Supplier.dc.html', body: SB, hasFile: false, file: '', answered: false, waiting: true, aWhen: '', answer: '' };
    const cOld = { st: '답변 완료', sCls: 'chip teal', cat: '결제 · 예치', t: '예치 영수증은 어디서 받나요?', d: '11월 4일' };
    const sOld = { st: '답변 완료', sCls: 'chip teal', cat: '계정', t: '정산 계좌를 사업자 계좌로 바꿀 수 있나요?', d: '11월 2일' };
    let MY;
    if (cl) MY = sent ? [cNew, cOld] : [cDone, cOld];
    else MY = sent ? [sNew, sOld] : [Object.assign({}, sNew, { d: '11월 4일' }), sOld];
    const myItems = MY.map((m, i) => Object.assign({}, m, { cls: 'hc-mr' + (i === 0 ? ' sel' : '') }));
    const faqLinks = cl ? ['대금은 언제 공급자에게 지급되나요?', '계약을 취소하면 환불받을 수 있나요?', '수수료는 얼마인가요?']
      : ['세금계산서와 원천징수는 어떻게 되나요?', '대금은 언제 공급자에게 지급되나요?', '견적을 낸 뒤 작업이 늘어나면 어떻게 하나요?'];
    return {
      guest: guest, isClient: cl, isSupplier: sp,
      tabAsk: form || guest ? 'on' : '', tabMy: (sent || myv) && !guest ? 'on' : '', myN: guest ? '' : MY.length,
      sent: sent && !guest, showForm: form && !guest, showMy: (sent || myv) && !guest,
      types: types, relContract: '예약 달력, 예약금 결제 외 2개 기능 · ' + (cl ? '최준호' : '온도 다이닝'),
      formTitle: cl ? '예치했는데 내 계약에 확인 중으로 나와요' : '중간 구간 지급 예정일이 궁금합니다',
      formBody: cl ? CB : SB,
      myItems: myItems, md: MY[0], faqLinks: faqLinks
    };
  }
}
