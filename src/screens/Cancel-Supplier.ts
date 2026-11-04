import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 취소 요청 받음 */
export default class CancelSupplierScreen extends Screen {
  static override readonly id = "Cancel-Supplier";
  static override readonly title = "공급자 — 취소 요청 받음";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["요청 받음", "이의 작성", "운영자 판정 중", "정산 확정"], "default": "요청 받음", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '요청 받음';
    const open = v === '요청 받음', form = v === '이의 작성', wait = v === '운영자 판정 중', done = v === '정산 확정';
    const F = (a: string[]) => [
      { b: '11월 8일 · 취소 요청', s: '의뢰인 · 사유 의뢰인 사정' },
      { b: done ? '11월 9일 · 동의' : (wait ? '11월 9일 · 이의 제기' : '내 답변'), s: done ? '정산이 바로 확정되었습니다' : (wait ? '운영자에게 넘어갔습니다' : '동의하거나 이의를 제기합니다') },
      { b: wait ? '운영자 판정' : '정산 확정', s: wait ? '근거를 보고 사유와 비율을 정합니다' : '보상 · 환불 금액이 정해집니다' },
      { b: '지급 · 환불', s: '운영자가 처리합니다' }
    ].map((x, i) => Object.assign(x, { cls: a[i] }));
    return {
      isOpen: open || form, isAsk: open, isForm: form, isWait: wait, isDone: done,
      title: done ? '계약이 취소되었습니다' : '의뢰인이 계약 취소를 요청했습니다',
      sub: done ? '취소 정산이 확정되었습니다. 받을 금액은 운영자가 처리한 뒤 정산 내역에 지급 완료로 표시됩니다.'
                : '예치 후 취소는 사유에 따라 정산합니다. 요청 내용과 정산 미리보기를 확인하고 동의하거나 이의를 제기하세요.',
      calcH: done ? '확정된 정산' : (wait ? '의뢰인 요청대로라면' : '동의하면 이렇게 정산됩니다'),
      stateTxt: done ? '취소됨' : '취소 요청 중',
      flow: open || form ? F(['done', 'now', '', '']) : wait ? F(['done', 'done', 'now', '']) : F(['done', 'done', 'done', 'now'])
    };
  }
}
