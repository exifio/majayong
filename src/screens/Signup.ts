import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 회원가입 — 계정 만들기 */
export default class SignupScreen extends Screen {
  static override readonly id = "Signup";
  static override readonly title = "회원가입 — 계정 만들기";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "이미 가입된 이메일"], "default": "기본", "section": "상태"}};


  renderVals(): Values {
    const dup = (this.props.view ?? '기본') === '이미 가입된 이메일';
    return { dup: dup, notDup: !dup, emailCls: dup ? 'inp warnline' : 'inp', nextCls: dup ? 'btn full off' : 'btn full' };
  }
}
