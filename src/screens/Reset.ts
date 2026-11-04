import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 비밀번호 재설정 */
export default class ResetScreen extends Screen {
  static override readonly id = "Reset";
  static override readonly title = "비밀번호 재설정";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["이메일 입력", "메일 보냄", "새 비밀번호", "링크 만료", "완료"], "default": "이메일 입력", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '이메일 입력';
    return { isAsk: v === '이메일 입력', isSent: v === '메일 보냄', isNew: v === '새 비밀번호', isExpired: v === '링크 만료', isDone: v === '완료' };
  }
}
