import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 입력 */
export default class InputClientScreen extends Screen {
  static override readonly id = "Input-Client";
  static override readonly title = "의뢰인 — 입력";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"state": {"editor": "enum", "options": ["첫 방문", "작성 중 초안 있음", "한도 도달"], "default": "작성 중 초안 있음", "section": "상태"}, "archivedOpen": {"editor": "boolean", "default": false, "section": "상태"}, "deleteConfirm": {"editor": "boolean", "default": false, "section": "상태"}};


  renderVals(): Values {
    const state = this.props.state ?? '작성 중 초안 있음';
    const first = state === '첫 방문';
    const atLimit = state === '한도 도달';
    const s = this.state || {};
    const archOpen = !first && (s.archOpen !== undefined ? s.archOpen : (this.props.archivedOpen ?? false));
    // 첫 행은 의뢰인 홈 '내 프로젝트'의 작성 중 행과 같은 값.
    // 이름은 프로젝트 제목과 같은 규칙(업종 · 대표 블록 외 N건), 금액은 플랫폼 평균 + 수수료 5%
    const all = [
      { when: '3일 전 수정', title: '단골 등급 관리 외 2개 기능',
        meta: '명세 항목 3개 · 채팅 수정 22회 남음', amount: '1,092,000원',
        hasTbd: false, tbd: '' },
      { when: '8일 전 수정', title: '예약 달력 외 4개 기능',
        meta: '명세 항목 5개 · 채팅 수정 30회 남음', amount: '4,305,000원',
        hasTbd: false, tbd: '' },
      { when: '12일 전 수정', title: '회차 예약 외 1개 기능',
        meta: '명세 항목 2개 · 채팅 수정 27회 남음', amount: '945,000원',
        hasTbd: false, tbd: '' }
    ];
    const drafts = atLimit ? all : all.slice(0, 1);
    return {
      atLimit: atLimit,
      canStart: !atLimit,
      showDrafts: !first,
      drafts: drafts,
      count: drafts.length,
      archOpen: archOpen,
      archClosed: !archOpen,
      archExpanded: archOpen ? 'true' : 'false',
      archLabel: archOpen ? '접기' : '펼치기',
      toggleArch: () => this.setState({ archOpen: !archOpen }),
      delOpen: this.props.deleteConfirm ?? false,
      delTitle: atLimit ? '회차 예약 외 1개 기능' : '좌석 배치도 외 1개 기능'
    };
  }
}
