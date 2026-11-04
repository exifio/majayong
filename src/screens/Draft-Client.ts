import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 초안·명세 2분할 */
export default class DraftClientScreen extends Screen {
  static override readonly id = "Draft-Client";
  static override readonly title = "의뢰인 — 초안·명세 2분할";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "초안 만드는 중", "만들기 실패", "채팅 반영 중"], "default": "기본", "section": "상태"}, "overBudget": {"editor": "boolean", "default": false, "section": "상태"}, "making": {"editor": "boolean", "default": false, "section": "상태"}, "budgetApplied": {"editor": "boolean", "default": false, "section": "상태"}, "chatLimit": {"editor": "boolean", "default": false, "section": "상태"}};


  renderVals(): Values {
    const over = this.props.overBudget ?? false;
    const making = this.props.making ?? false;
    const applied = (this.props.budgetApplied ?? false) && !over;
    const chatLimit = this.props.chatLimit ?? false;
    const view = this.props.view ?? '기본';
    const isMaking = view === '초안 만드는 중', isFail = view === '만들기 실패', isUpd = view === '채팅 반영 중';
    const won = (n: number) => n.toLocaleString('ko-KR') + '원';
    // 시연 데이터 정본: 포함 4건 4,200,000 + 수수료 5% = 4,410,000 / 희망 예산 5,000,000
    const sub = 4200000 + (over ? 660000 : 0);
    const fee = Math.floor(sub * 0.05);
    const total = sub + fee;
    const budget = 5000000;
    return {
      isGen: isMaking || isFail, isNormal: !(isMaking || isFail), isMaking: isMaking, isFail: isFail, isUpd: isUpd,
      chatIdle: !chatLimit && !isUpd,
      genTitle: isFail ? '화면 초안' : '화면 초안을 그리고 있습니다',
      genSub: isFail ? '다시 만들어 보거나, 업종 기본 구성에서 시작할 수 있습니다.' : '적어 주신 문장에서 필요한 기능을 찾아 블록으로 맞추고, 화면 초안과 명세를 함께 만듭니다.',
      siPay: 'si derived' + (isUpd ? ' upd' : ''), cbPay: 'cb cbc' + (isUpd ? ' upd' : ''),
      overBudget: over,
      underBudget: !over && !applied,
      applied: applied, notApplied: !applied,
      making: making,
      hasOut: !over,
      chatLimit: chatLimit,
      chatOpen: !chatLimit,
      fnCount: over ? 5 : 4,
      itemCount: (over ? 5 : 4) + (making ? 1 : 0),
      sub: won(sub),
      fee: won(fee),
      total: won(total),
      gap: won(Math.abs(budget - total))
    };
  }
}
