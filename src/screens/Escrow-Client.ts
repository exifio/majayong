import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 예치하기 */
export default class EscrowClientScreen extends Screen {
  static override readonly id = "Escrow-Client";
  static override readonly title = "의뢰인 — 예치하기";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["결제 전", "결제 실패", "확인 중", "예치 완료"], "default": "결제 전", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '결제 전';
    const before = v === '결제 전', fail = v === '결제 실패', wait = v === '확인 중', done = v === '예치 완료';
    return {
      isBefore: before, isFail: fail, isWait: wait, isDone: done,
      showPm: !done, showAgree: before || fail, showDl: before || fail,
      title: done ? '예치 완료' : '예치하기',
      sub: done ? '예치가 끝나 작업이 시작되었습니다. 진행 상황은 내 계약에서, 지급 내역은 정산 내역에서 보실 수 있습니다.'
                : '계약이 체결되었습니다. 예치하면 내 계약에 예치 완료로 표시되고, 예치 다음 날부터 작업 기간(42일)이 시작됩니다.',
      chip: done ? '진행 중' : '예치 대기', chipCls: done ? 'chip blue' : 'chip amber',
      periodSub: done ? '11월 5일 ~ 12월 16일' : '예치 다음 날부터',
      payH: done ? '예치한 금액' : '예치할 금액',
      totK: done ? '예치한 금액' : '예치할 금액',
      pmCard: 'lbl on' + (wait ? ' off' : ''), pmBank: 'lbl' + (wait ? ' off' : '')
    };
  }
}
