import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 운영자 — 이견 개입 */
export default class AdminDisputesScreen extends Screen {
  static override readonly id = "Admin-Disputes";
  static override readonly title = "운영자 — 이견 개입";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["검토 중", "판정 작성", "판정 완료"], "default": "검토 중", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '검토 중';
    const review = v === '검토 중', write = v === '판정 작성', done = v === '판정 완료';
    return {
      isReview: review, isWrite: write, isDone: done,
      nRefund: 1, nDispute: done ? 0 : 1,
      more: done ? '이 건 말고 지난 판정 완료 2건이 더 있습니다 · 이벤트 기록에서 볼 수 있습니다.' : "같은 항목에 보완 요청이 3회 이상이거나, 어느 한쪽이 '운영자에게 도움 요청'을 누르면 여기에 올라옵니다.",
      tabO: done ? '' : 'on', tabD: done ? 'on' : '', nO: done ? 0 : 1, nD: done ? 3 : 2,
      lChip: done ? '판정 완료' : '검토 중', lChipCls: done ? 'chip teal' : 'chip'
    };
  }
}
