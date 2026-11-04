import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 내 프로젝트 */
export default class MyClientScreen extends Screen {
  static override readonly id = "My-Client";
  static override readonly title = "의뢰인 — 내 프로젝트";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["홈과 같은 데이터", "모든 상태 예시", "프로젝트 없음"], "default": "홈과 같은 데이터", "section": "상태"}, "deleteConfirm": {"editor": "boolean", "default": false, "section": "상태"}};


  renderVals(): Values {
    const view = this.props.view ?? '홈과 같은 데이터';
    const s = this.state || {};
    const archOpen = s.archOpen ?? false;
    const row = (o: Values) => Object.assign({
      chipCls: '', isDraft: false, urgent: false, calm: true, hasNote: false, note: '', hasTbd: false, tbd: '',
      hasLink: false, link: '', linkHref: '#', amtLabel: '수수료 포함 예상 총액', hasAmt: true
    }, o);
    // 홈 '내 프로젝트'와 같은 두 행
    const recruiting = row({ chip: '모집 중', chipCls: 'blue', urgent: true, calm: false, when: '마감 11월 3일 · 2일 남음',
      title: '예약 달력, 예약금 결제 외 2개 기능',
      meta: '명세 항목 4개 · 지원 3건 · 문의 중 2건 · 명세를 상세 열람한 공급자 5명',
      amtLabel: '받은 견적', amount: '3건', hasTbd: true, tbd: '새 메시지 1건', action: '제안 비교하기', href: 'Compare-Client.dc.html',
      hasLink: true, link: '명세 보기', linkHref: 'Spec-Client.dc.html' });
    const drafting = row({ chip: '작성 중', when: '3일 전 수정',
      title: '단골 등급 관리 외 2개 기능',
      meta: '명세 항목 3개 · 채팅 수정 22회 남음',
      amount: '1,092,000원', action: '이어서 고치기', href: 'Draft-Client.dc.html', isDraft: true });
    // 모든 상태 예시 — 지금 할 일이 있는 것부터
    const signing = row({ chip: '임시 계약', chipCls: 'amber', urgent: true, calm: false, when: '서명 기한 11월 10일 · 7일 남음',
      title: '노쇼 위약금 자동 청구 외 1개 기능',
      meta: '공급자 이도윤 · 작업 28일 · 보류 중인 지원 2건',
      note: '채팅에서 \'이 사람과 계약하기\'로 최종 합의를 마쳐 임시 계약이 되었습니다. 두 분이 서명하면 계약이 체결되고, 대금을 예치하면 보류한 지원은 자동으로 거절됩니다.', hasNote: true,
      amtLabel: '합의 금액', amount: '1,650,000원', action: '계약서 확인하기', href: 'Contract-Client.dc.html' });
    const expired = row({ chip: '모집 마감 · 지원 0건', when: '10월 25일 마감',
      title: '재방문 알림 외 1개 기능',
      meta: '명세 항목 2개 · 지원 0건 · 명세를 상세 열람한 공급자 2명',
      note: '지원이 없었습니다. 마감을 늘리거나 명세를 고쳐 다시 올릴 수 있습니다.', hasNote: true,
      hasAmt: false, amount: '', action: '마감 연장', href: 'Spec-Client.dc.html',
      hasLink: true, link: '명세 고치기', linkHref: 'Spec-Client.dc.html' });
    const scheduled = row({ chip: '모집 예정', chipCls: 'out', when: '11월 10일 시작 · 11월 17일 마감',
      title: '알레르기·선호 메모 외 1개 기능',
      meta: '명세 항목 2개',
      hasAmt: false, amount: '', action: '명세 보기', href: 'Spec-Client.dc.html' });
    const selecting = row({ chip: '선택 중', chipCls: 'amber', urgent: true, calm: false, when: '선택 기간 11월 17일까지',
      title: '회차 예약 외 1개 기능',
      meta: '명세 항목 2개 · 보류했던 지원 2건',
      note: '임시 계약이 서명 기한 안에 끝나지 않아 결렬되었습니다. 마감일이 지나 보류했던 지원 중에서만 고를 수 있습니다.', hasNote: true,
      amtLabel: '받은 견적', amount: '2건', action: '제안 비교하기', href: 'Compare-Client.dc.html',
      hasLink: true, link: '마감 연장하기', linkHref: 'Spec-Client.dc.html' });
    const active = row({ chip: '계약 중', chipCls: 'blue', when: '중간 검수 대기',
      title: '예약 확정 문자 외 2개 기능',
      meta: '공급자 한서윤 · 예치 완료 · 중간 납품 10월 27일',
      amtLabel: '합의 금액', amount: '980,000원', action: '중간 납품 검수하기', href: 'Inspect-Client.dc.html' });
    const done = row({ chip: '완료', chipCls: 'teal', when: '10월 2일 완료',
      title: '리마인드 알림 외 1개 기능',
      meta: '공급자 박서준 · 최종 지급 완료',
      amtLabel: '합의 금액', amount: '760,000원', action: '리뷰 쓰기', href: 'Review-Client.dc.html' });
    let rows: Values[] = [], c = { all: 0, draft: 0, recruit: 0, contract: 0, done: 0 };
    if (view === '홈과 같은 데이터') { rows = [recruiting, drafting]; c = { all: 2, draft: 1, recruit: 1, contract: 0, done: 0 }; }
    if (view === '모든 상태 예시') { rows = [signing, selecting, recruiting, expired, drafting, scheduled, active, done]; c = { all: 8, draft: 1, recruit: 4, contract: 2, done: 1 }; }
    const empty = view === '프로젝트 없음';
    return {
      rows: rows, hasAny: !empty, isEmpty: empty,
      cAll: c.all, cDraft: c.draft, cRecruit: c.recruit, cContract: c.contract, cDone: c.done,
      archOpen: archOpen, archClosed: !archOpen,
      archExpanded: archOpen ? 'true' : 'false', archLabel: archOpen ? '접기' : '펼치기',
      toggleArch: () => this.setState({ archOpen: !archOpen }),
      delOpen: this.props.deleteConfirm ?? false,
      delTitle: '단골 등급 관리 외 2개 기능'
    };
  }
}
