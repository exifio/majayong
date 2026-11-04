import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 내 견적 보기 */
export default class QuoteviewSupplierScreen extends Screen {
  static override readonly id = "QuoteView-Supplier";
  static override readonly title = "공급자 — 내 견적 보기";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["문의 중", "이전 명세 기준", "임시 계약 중"], "default": "문의 중", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '문의 중';
    const ask = v === '문의 중', stale = v === '이전 명세 기준', held = v === '임시 계약 중';
    return {
      isAsk: ask, isStale: stale, isHeld: held, canWithdraw: !held,
      chip: held ? '임시 계약 · 서명 대기' : (stale ? '이전 명세 기준' : '문의 중'),
      chipCls: held ? 'chip amber' : (stale ? 'chip amber' : 'chip blue'),
      curH: stale ? '지금 견적 · 이전 명세 기준' : '지금 견적 · 2회차'
    };
  }
}
