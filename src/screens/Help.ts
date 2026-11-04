import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공통 — 고객센터 */
export default class HelpScreen extends Screen {
  static override readonly id = "Help";
  static override readonly title = "공통 — 고객센터";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"who": {"editor": "enum", "options": ["의뢰인", "공급자", "비로그인"], "default": "비로그인", "section": "상태"}, "view": {"editor": "enum", "options": ["자주 묻는 질문", "검색 결과", "공지 펼침", "공지사항"], "default": "자주 묻는 질문", "section": "상태"}, "cat": {"editor": "enum", "options": ["전체", "의뢰인", "공급자", "결제 · 정산", "계정"], "default": "전체", "section": "상태"}};


  renderVals(): Values {
    const who = this.props.who ?? '의뢰인', v = this.props.view ?? '자주 묻는 질문';
    const guest = who === '비로그인', cl = who === '의뢰인', sp = who === '공급자';
    const search = v === '검색 결과', form = v === '1:1 문의 작성', sent = v === '문의 보냄', myv = v === '내 문의';
    const F = [
      ['의뢰인', '어떤 기능이 필요한지 몰라도 맡길 수 있나요?', '네. 가게에서 불편한 점을 문장으로 적으면 AI가 필요한 기능과 화면 초안을 만들어 드립니다. 초안을 보며 고친 뒤 확정하면 그 명세로 공급자를 모집합니다.', '프로젝트 시작하기', 'Input-Client.dc.html'],
      ['결제 · 정산', '대금은 언제 공급자에게 지급되나요?', '계약을 맺으면 3일 안에 대금을 마자용에 예치합니다. 공급자가 구간별로 납품하면 의뢰인이 7일 안에 검수하고, 승인한 구간만 지급됩니다. 7일 안에 승인이나 보완 요청이 없으면 자동 승인되어 지급됩니다.', '내 계약 보기', 'Contracts-Client.dc.html'],
      ['결제 · 정산', '수수료는 얼마인가요?', '의뢰인과 공급자 모두 계약 금액의 5%입니다. 의뢰인은 예치할 때 함께 내고, 공급자는 지급받을 때 빠집니다. 지급이 확정된 금액에만 붙고, 화면의 금액은 모두 부가세 포함입니다.', '', ''],
      ['결제 · 정산', '계약을 취소하면 환불받을 수 있나요?', '예치 후 24시간 안이고 납품 전이면 전액 환불됩니다. 그 뒤 납품 전에 취소하면 진행 중 구간의 50%를 공급자에게 보상하고, 이미 납품한 구간은 전액 지급됩니다. 공급자 사정으로 취소하면 지급되지 않은 금액은 모두 돌려드립니다. 상대가 동의하지 않으면 운영자가 판정합니다.', '', ''],
      ['공급자', '지원하기 전에 의뢰인에게 질문할 수 있나요?', '지원 전에는 채팅할 수 없습니다. 견적을 낼 때 \'의뢰인에게 묻고 싶은 것\'을 최대 3개 남기면, 의뢰인이 문의 채팅을 열어 답합니다.', '', ''],
      ['공급자', '세금계산서와 원천징수는 어떻게 되나요?', '사업자 공급자는 받은 대금으로 의뢰인에게 세금계산서를 직접 발행하고, 원천징수는 없습니다. 개인 공급자는 지급할 때 사업소득 3.3%를 원천징수합니다. 플랫폼 수수료 증빙은 마자용이 발행합니다.', '', ''],
      ['의뢰인', '예상 총액은 어떻게 계산되나요?', '기능마다 AI가 분석해 둔 단가를 더하고 수수료 5%를 포함해 계산합니다. 같은 기능은 누구에게나 같은 금액이고, 기능별 금액과 근거는 단가 분석 리포트에서 볼 수 있습니다. 예상 총액은 참고용이며, 실제 금액은 공급자의 견적과 합의로 정해집니다.', '', ''],
      ['의뢰인', '내 명세를 공급자가 함부로 가져가지 않나요?', '공급자는 가입할 때 명세 비밀유지 의무에 동의합니다. 누가 상세 명세를 열람했는지 기록이 남고, 계약이 체결되기 전까지 채팅의 연락처는 가려집니다.', '', ''],
      ['의뢰인', '계약한 뒤에 기능을 더 넣을 수 있나요?', '계약 범위는 양쪽이 서명하는 순간 고정되어, 모르는 사이에 늘거나 중간에 조건이 바뀌지 않습니다. 확정된 명세는 검수 기준으로 계약서에 붙습니다. 더 필요한 기능은 새 프로젝트로 맡겨 주세요.', '', ''],
      ['공급자', '의뢰인은 무엇을 보고 공급자를 고르나요?', '경력 · 평점 · 리뷰 · 포트폴리오 요약과 견적 총액을 함께 봅니다. 항목별 금액을 나란히 놓고 비교하지 않고, 의뢰인이 본 AI 예상 금액은 공급자에게 보이지 않습니다. 블록 가격을 미리 등록할 필요도 없습니다.', '', ''],
      ['공급자', '견적을 낸 뒤 작업이 늘어나면 어떻게 하나요?', '계약 전에는 채팅에서 [견적 수정]으로 총액과 기간을 고칠 수 있습니다. 서명한 뒤에는 범위가 고정되고, 더 필요한 기능은 의뢰인이 새 프로젝트로 맡깁니다.', '', ''],
      ['결제 · 정산', '마자용이 계약 당사자인가요?', '아니요. 마자용은 통신판매중개자로서 의뢰인과 공급자를 연결하고 대금 예치와 정산을 관리합니다. 계약 이행 책임은 각 당사자에게 있으며, 이 사실은 계약서와 결제 화면에 표시됩니다.', '', ''],
      ['계정', '의뢰인과 공급자를 한 계정으로 함께 쓸 수 있나요?', '역할은 가입할 때 정해지고 바꿀 수 없습니다. 두 역할이 모두 필요하면 다른 이메일로 계정을 하나 더 만들어 주세요.', '', ''],
      ['계정', '계약 전에 연락처를 주고받을 수 있나요?', '계약을 맺기 전에는 채팅의 전화번호 · 이메일 · 메신저 아이디가 자동으로 가려집니다. 양쪽이 서명해 계약이 체결되면 그때부터 주고받을 수 있습니다.', '', '']
    ];
    const st = this.state || {};
    const cat: string = search ? '전체' : (this.props.cat ?? '전체');
    const order = search ? [3, 1, 2] : [0, 6, 7, 8, 1, 2, 3, 11, 4, 9, 10, 5, 12, 13];
    // 분류 탭: 같은 목록을 그 분류로 거르고 첫 줄을 펼친다. 줄을 누르면 그 자리에서 펼침 — 한 번에 하나만
    const pick = cat === '전체' ? order : order.filter(i => F[i][0] === cat);
    const fAt = v + '|' + cat;
    const fOpen = st.fAt === fAt && typeof st.fOpen === 'number' ? st.fOpen : pick[0];
    const faqs = pick.map((i) => { const f = F[i]; const open = i === fOpen;
      return { cls: open ? 'hc-q open' : 'hc-q', open: open, arrow: open ? '▴' : '▾', cat: f[0], q: f[1], a: f[2], hasGo: open && !!f[3] && !guest, go: f[3], goHref: f[4],
        toggle: () => this.setState({ fAt: fAt, fOpen: open ? -1 : i }) }; });
    const tabs = ['전체', '의뢰인', '공급자', '결제 · 정산', '계정'].map(n => ({ name: n, cls: n === cat ? 'on' : '', href: '?cat=' + n.replace(/ /g, '+'), cur: n === cat ? 'page' : null }));
    const types = ['이용 방법', '결제 · 예치', '검수 · 지급', '계약 취소', '계정', '기타'].map(n => ({ name: n, on: n === '결제 · 예치' ? 'true' : 'false', cls: n === '결제 · 예치' ? 'on' : '' }));
    const mine = cl
      ? [{ st: '답변 완료', cls: 'chip teal', t: '예치했는데 내 계약에 확인 중으로 나와요', d: '11월 4일' }, { st: '답변 완료', cls: 'chip teal', t: '예치 영수증은 어디서 받나요?', d: '11월 4일' }]
      : [{ st: '답변 대기', cls: 'chip amber', t: '중간 구간 지급 예정일이 궁금합니다', d: '11월 4일' }, { st: '답변 완료', cls: 'chip teal', t: '정산 계좌를 사업자 계좌로 바꿀 수 있나요?', d: '11월 2일' }];
    if (sent) mine.unshift({ st: '답변 대기', cls: 'chip amber', t: cl ? '예치했는데 내 계약에 확인 중으로 나와요' : '중간 구간 지급 예정일이 궁금합니다', d: '방금' });
    const A1 = '안녕하세요, 마자용 운영팀입니다.\n11월 4일 14:20 결제 건(카드 끝자리 4821)은 같은 시각 결제사 통지가 들어와 예치 완료로 처리되어 있습니다. 지금 내 계약에서도 \'진행 중 · 예치 완료\'로 보이고, 공급자 작업이 시작되었습니다.\n결제 직후 잠시 \'확인 중\'으로 보였다면 화면이 바뀌기 전이었던 것으로 보입니다. 새로고침 뒤에도 같다면 다시 문의해 주세요.';
    const SB = '중간 구간 납품을 준비하고 있습니다.\n의뢰인이 승인하면 지급까지 며칠 걸리는지 알고 싶습니다.';
    const MY = cl ? [
      { st: '답변 완료', sCls: 'chip teal', cat: '결제 · 예치', t: '예치했는데 내 계약에 확인 중으로 나와요', d: '11월 4일', when: '11월 4일 14:41', contract: '예약 달력, 예약금 결제 외 2개 기능 · 최준호', cHref: 'Contracts-Client.dc.html', body: '11월 4일 14:20에 카드로 3,255,000원을 결제했습니다.\n내 계약에는 아직 \'확인 중\'으로 보여서 문의드립니다.', hasFile: true, file: '결제 문자 캡처.png · 214KB', answered: true, waiting: false, aWhen: '11월 4일 15:02', answer: A1 },
      { st: '답변 완료', sCls: 'chip teal', cat: '결제 · 예치', t: '예치 영수증은 어디서 받나요?', d: '11월 4일' }
    ] : [
      { st: '답변 대기', sCls: 'chip amber', cat: '검수 · 지급', t: '중간 구간 지급 예정일이 궁금합니다', d: '11월 4일', when: '11월 4일 11:20', contract: '예약 달력, 예약금 결제 외 2개 기능 · 온도 다이닝', cHref: 'Contracts-Supplier.dc.html', body: SB, hasFile: false, file: '', answered: false, waiting: true, aWhen: '', answer: '' },
      { st: '답변 완료', sCls: 'chip teal', cat: '계정', t: '정산 계좌를 사업자 계좌로 바꿀 수 있나요?', d: '11월 2일' }
    ];
    const myItems = MY.map((m, i) => Object.assign({}, m, { cls: 'hc-mr' + (i === 0 ? ' sel' : '') }));
    const nOpen = v === '공지 펼침', nAll = v === '공지사항';
    const N = [
      ['안내', 'chip blue', '예치 · 검수 기한 하루 전에 알림으로 알려 드립니다', '11월 3일', '예치 기한(계약 체결 후 3일)과 검수 기한(납품 후 7일) 하루 전에 화면 위 알림으로 알려 드립니다. 기한이 지나면 예치는 자동 결렬, 검수는 자동 승인됩니다. 이메일 · 문자 알림은 보내지 않습니다.', guest ? '' : '내 계약 보기', cl ? 'Contracts-Client.dc.html' : 'Contracts-Supplier.dc.html'],
      ['정책', 'chip', '수수료 증빙과 세금계산서 발행 방식 안내', '11월 1일', '마자용 수수료(5%) 증빙은 마자용이 발행합니다 — 사업자는 세금계산서, 개인은 카드 매출전표 또는 현금영수증. 대금 세금계산서는 사업자 공급자가 의뢰인에게 직접 발행하고, 개인 공급자는 지급 때 3.3%를 원천징수합니다.', '', ''],
      ['안내', 'chip blue', '1:1 문의 답변은 알림과 \'내 문의\'에서 확인하세요', '10월 30일', '1:1 문의에 답변이 오면 알림으로 알려 드리고, 고객센터 › 1:1 문의 › 내 문의에서 다시 볼 수 있습니다. 평일 기준 하루 안에 답변 드립니다.', '1:1 문의', 'Help-Inquiry.dc.html'],
      ['정책', 'chip', '계약 전 연락처는 자동으로 가려집니다', '10월 28일', '계약이 체결되기 전에는 채팅 · 견적 메시지의 전화번호 · 이메일 · 메신저 아이디가 \'연락처 가림\'으로 바뀝니다. 플랫폼 밖 거래를 권하는 메시지는 \'신고\'를 눌러 주세요.', '', ''],
      ['안내', 'chip blue', '마자용 서비스를 시작합니다', '10월 27일', '예약 기반 음식점부터 시작합니다. 한 문장을 적으면 화면 초안이 먼저 나오고, 고친 그대로 명세가 되어 공급자의 견적을 받을 수 있습니다.', '', '']
    ];
    const NI = nAll ? [0, 1, 2, 3, 4] : [0, 1, 4];
    // 공지 줄: 그 자리에서 펼침, 한 번에 하나만. 기본은 모두 접힘, '공지 펼침' · '공지사항'은 첫 줄 펼침
    const nOpenAt = st.nAt === v && typeof st.nOpen === 'number' ? st.nOpen : (nOpen || nAll ? NI[0] : -1);
    const notices = NI.map((i) => { const n = N[i]; const open = i === nOpenAt;
      return { tag: n[0], cls: n[1], title: n[2], date: n[3], body: n[4], go: n[5], goHref: n[6], hasGo: !!n[5], open: open, arrow: open ? '▴' : '▾', liCls: open ? 'open' : '',
        toggle: () => this.setState({ nAt: v, nOpen: open ? -1 : i }) }; });
    return {
      who: who, guest: guest, isClient: cl, isSupplier: sp, member: !guest,
      query: search ? '환불' : '',
      quick: ['예상 금액', '환불 · 취소', '검수 기한', '수수료', '세금계산서', '계정 · 역할'],
      showFaq: !form && !myv && !nAll, nCount: nAll ? '5개' : '', nLink: nAll ? '자주 묻는 질문 보기' : '전체 보기', nHref: nAll ? '?view=자주+묻는+질문' : '?view=공지사항', showForm: form || (myv && guest), showMy: myv && !guest, myItems: myItems, md: MY[0], myCount: MY.length + '건', showMine: !guest, sent: sent, isSearch: search, showTabs: !search,
      faqTitle: search ? '\'환불\' 검색 결과' : '자주 묻는 질문', faqCount: search ? '3건' : pick.length + '개',
      faqs: faqs, tabs: tabs, types: types,
      relContract: '예약 달력, 예약금 결제 외 2개 기능 · ' + (cl ? '최준호' : '온도 다이닝'),
      formTitle: cl ? '예치했는데 내 계약에 확인 중으로 나와요' : '중간 구간 지급 예정일이 궁금합니다',
      formBody: cl ? '11월 4일 14:20에 카드로 3,255,000원을 결제했습니다.\n내 계약에는 아직 \'확인 중\'으로 보여서 문의드립니다.' : SB,
      askCls: guest ? 'btn gh' : 'btn', mine: mine, notices: notices
    };
  }
}
