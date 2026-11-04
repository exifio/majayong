import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 운영자 — 환불 처리 */
export default class AdminRefundsScreen extends Screen {
  static override readonly id = "Admin-Refunds";
  static override readonly title = "운영자 — 환불 처리";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["처리 대기", "사유 다툼 판정", "처리 완료"], "default": "처리 대기", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '처리 대기';
    const pend = v === '처리 대기', judge = v === '사유 다툼 판정', done = v === '처리 완료';
    return {
      isPending: pend, isJudge: judge, isDone: done, showRefund: pend || done,
      nRefund: done ? 0 : (judge ? 2 : 1), nDispute: 1,
      tabP: pend ? 'on' : '', tabJ: judge ? 'on' : '', tabD: done ? 'on' : '',
      nP: done ? 0 : 1, nJ: judge ? 1 : 0, nD: done ? 3 : 2,
      stChip: done ? 'chip teal' : 'chip amber', stText: done ? '처리 완료' : '처리 대기',
      lastCls: done ? '' : 'now',
      lastB: done ? '11월 21일 · 운영자 처리 완료' : '지금 · 운영자 처리 대기',
      lastS: done ? '환불 · 지급 모두 완료로 표시 · 정산 내역에 반영' : '아래 두 건을 처리하고 완료로 표시합니다'
    };
  }
}
